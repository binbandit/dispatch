import type { AiSuggestion } from "@/renderer/lib/review/ai-suggestions";
/* eslint-disable import/max-dependencies, max-depth, max-params -- Diff rendering is dense and performance-sensitive; targeted tests give better protection than these structural caps here. */
import type { GhReactionGroup } from "@/shared/ipc";
import type { Highlighter } from "shiki";

import { cn } from "@/lib/utils";
import { AiSuggestionGroup } from "@/renderer/components/review/ai/ai-suggestion-card";
import { CommentComposer } from "@/renderer/components/review/comments/comment-composer";
import {
  InlineComment,
  type ReviewComment,
} from "@/renderer/components/review/comments/inline-comment";
import { BlameButton } from "@/renderer/components/review/diff/blame-popover";
import { CiAnnotation, type Annotation } from "@/renderer/components/review/diff/ci-annotation";
import { useTheme } from "@/renderer/lib/app/theme-context";
import {
  getDiffFilePath,
  type DiffFile,
  type DiffLine,
  type Segment,
} from "@/renderer/lib/review/diff-parser";
import {
  DEFAULT_CODE_THEME_DARK,
  DEFAULT_CODE_THEME_LIGHT,
  getShikiTokenColor,
  type ShikiToken,
  type ThemeMode,
} from "@/renderer/lib/review/highlighter";
import { getReviewPositionKey } from "@/renderer/lib/review/review-position";
import { ChevronDown, ChevronUp, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Table-based diff viewer with:
 * - Cmd+F search with match highlighting + navigation
 * - Multi-line drag-to-select for comments
 * - Full-file mode (shows entire file with changes highlighted)
 * - Split/side-by-side diff mode
 */

type CommentSide = "LEFT" | "RIGHT";

interface CommentTarget {
  line: number;
  side: CommentSide;
}

export interface CommentRange {
  startLine: number;
  endLine: number;
  side: CommentSide;
}

export type DiffMode = "unified" | "split" | "full-file";

interface DiffViewerProps {
  file: DiffFile;
  highlighter?: Highlighter | null;
  language?: string;
  comments?: Map<string, ReviewComment[]>;
  annotations?: Map<string, Annotation[]>;
  prNumber?: number;
  activeComposer?: CommentRange | null;
  onCommentRange?: (range: CommentRange) => void;
  onCloseComposer?: () => void;
  /** Full file content for "show full file" mode */
  fullFileContent?: string | null;
  diffMode?: DiffMode;
  /** Set of thread node IDs that are resolved (from reviewThreads) */
  resolvedThreadIds?: Set<string>;
  /** Reaction data for review comments, keyed by databaseId (as string) */
  reviewCommentReactions?: Record<string, GhReactionGroup[]>;
  /** AI-generated suggestions, keyed by "path:line" */
  aiSuggestions?: Map<string, AiSuggestion[]>;
  reviewActionsEnabled?: boolean;
  bottomOverlayInset?: number;
  onPostSuggestion?: (suggestion: AiSuggestion, body?: string) => Promise<void>;
  onDismissSuggestion?: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Flat row model
// ---------------------------------------------------------------------------

type FlatLine = DiffLine & { pairKey: string | null };

type FlatRow =
  | { kind: "line"; key: string; line: FlatLine }
  | { kind: "comment"; key: string; comments: ReviewComment[] }
  | { kind: "annotation"; key: string; annotations: Annotation[] }
  | { kind: "composer"; key: string; startLine: number; endLine: number; side: CommentSide }
  | { kind: "ai-suggestion"; key: string; suggestions: AiSuggestion[] };

type NonLineFlatRow = Exclude<FlatRow, { kind: "line" }>;

type SplitRow =
  | { kind: "pair"; key: string; left: FlatLine | null; right: FlatLine | null }
  | NonLineFlatRow;

interface FlatLineEntry {
  key: string;
  line: FlatLine;
}

const DEFAULT_SHIKI_THEME_PAIR = {
  light: DEFAULT_CODE_THEME_LIGHT,
  dark: DEFAULT_CODE_THEME_DARK,
} as const;

function getCommentTarget(line: DiffLine): CommentTarget | null {
  if (line.type === "del" && line.oldLineNumber !== null) {
    return { line: line.oldLineNumber, side: "LEFT" };
  }

  if (line.type !== "hunk-header" && line.newLineNumber !== null) {
    return { line: line.newLineNumber, side: "RIGHT" };
  }

  return null;
}

function appendLineRows(
  rows: FlatRow[],
  filePath: string,
  lineEntry: FlatLineEntry,
  comments: Map<string, ReviewComment[]>,
  annotations: Map<string, Annotation[]>,
  composerRange: CommentRange | null,
  aiSuggestions?: Map<string, AiSuggestion[]>,
) {
  rows.push({ kind: "line", key: lineEntry.key, line: lineEntry.line });

  const commentTarget = getCommentTarget(lineEntry.line);
  if (!commentTarget) {
    return;
  }

  const lineNum = commentTarget.line;
  const commentKey = getReviewPositionKey(filePath, lineNum, commentTarget.side);
  const lineComments = comments.get(commentKey);
  if (lineComments && lineComments.length > 0) {
    rows.push({ kind: "comment", key: `cmt-${commentKey}`, comments: lineComments });
  }

  if (commentTarget.side === "RIGHT") {
    const positionKey = `${filePath}:${lineNum}`;

    const lineAnnotations = annotations.get(positionKey);
    if (lineAnnotations && lineAnnotations.length > 0) {
      rows.push({ kind: "annotation", key: `ann-${positionKey}`, annotations: lineAnnotations });
    }

    const lineSuggestions = aiSuggestions?.get(positionKey);
    if (lineSuggestions && lineSuggestions.length > 0) {
      rows.push({
        kind: "ai-suggestion",
        key: `ai-${positionKey}`,
        suggestions: lineSuggestions,
      });
    }
  }

  if (
    composerRange &&
    commentTarget.side === composerRange.side &&
    commentTarget.line === composerRange.endLine
  ) {
    rows.push({
      kind: "composer",
      key: `composer-${composerRange.side}-${composerRange.startLine}-${composerRange.endLine}`,
      startLine: composerRange.startLine,
      endLine: composerRange.endLine,
      side: composerRange.side,
    });
  }
}

function buildRows(
  file: DiffFile,
  comments: Map<string, ReviewComment[]>,
  annotations: Map<string, Annotation[]>,
  composerRange: CommentRange | null,
  aiSuggestions?: Map<string, AiSuggestion[]>,
): FlatRow[] {
  const rows: FlatRow[] = [];
  const filePath = getDiffFilePath(file);

  let hunkIndex = 0;
  for (const hunk of file.hunks) {
    rows.push({
      kind: "line",
      key: `hunk-${hunkIndex}`,
      line: {
        type: "hunk-header",
        content: hunk.header,
        oldLineNumber: null,
        newLineNumber: null,
        pairKey: null,
      },
    });

    for (let i = 0; i < hunk.lines.length; i++) {
      const line = hunk.lines[i];
      if (!line) {
        break;
      }

      if (line.type !== "hunk-header") {
        const lineKey = `line-${hunkIndex}-${i}-${line.type}-${line.oldLineNumber ?? "x"}-${line.newLineNumber ?? "x"}`;

        appendLineRows(
          rows,
          filePath,
          {
            key: lineKey,
            line: {
              ...line,
              pairKey: line.pairId === undefined ? null : `pair-${hunkIndex}-${line.pairId}`,
            },
          },
          comments,
          annotations,
          composerRange,
          aiSuggestions,
        );
      }
    }
    hunkIndex++;
  }

  return rows;
}

function buildSplitRows(rows: FlatRow[]): SplitRow[] {
  const splitRows: SplitRow[] = [];
  const pendingDeleted: Array<{
    row: Extract<FlatRow, { kind: "line" }>;
    auxiliaryRows: NonLineFlatRow[];
  }> = [];
  let lastLineDestination:
    | { kind: "direct" }
    | { kind: "pending-deleted"; entry: (typeof pendingDeleted)[number] }
    | null = null;

  const flushPendingDeletedAtIndex = (index: number) => {
    const pendingEntry = pendingDeleted[index];
    if (!pendingEntry) {
      return;
    }

    splitRows.push({
      kind: "pair",
      key: pendingEntry.row.key,
      left: pendingEntry.row.line,
      right: null,
    });
    splitRows.push(...pendingEntry.auxiliaryRows);
    pendingDeleted.splice(index, 1);
  };

  const flushLeadingUnpairedDeleted = () => {
    while (pendingDeleted[0]?.row.line.pairKey === null) {
      flushPendingDeletedAtIndex(0);
    }
  };

  const flushAllPendingDeleted = () => {
    while (pendingDeleted.length > 0) {
      flushPendingDeletedAtIndex(0);
    }
  };

  for (const row of rows) {
    if (row.kind !== "line") {
      if (lastLineDestination?.kind === "pending-deleted") {
        lastLineDestination.entry.auxiliaryRows.push(row);
      } else {
        splitRows.push(row);
      }
    } else if (row.line.type === "hunk-header") {
      flushAllPendingDeleted();
      splitRows.push({ kind: "pair", key: row.key, left: row.line, right: null });
      lastLineDestination = { kind: "direct" };
    } else {
      if (row.line.type === "del") {
        const pendingEntry = { row, auxiliaryRows: [] as NonLineFlatRow[] };
        pendingDeleted.push(pendingEntry);
        lastLineDestination = { kind: "pending-deleted", entry: pendingEntry };
      } else if (row.line.type === "add") {
        const matchedPendingIndex =
          row.line.pairKey === null
            ? -1
            : pendingDeleted.findIndex(
                (pendingEntry) => pendingEntry.row.line.pairKey === row.line.pairKey,
              );

        if (matchedPendingIndex >= 0) {
          while (pendingDeleted[0]?.row.line.pairKey !== row.line.pairKey) {
            flushPendingDeletedAtIndex(0);
          }

          const matchedPending = pendingDeleted.shift();
          if (matchedPending) {
            splitRows.push({
              kind: "pair",
              key: `${matchedPending.row.key}-${row.key}`,
              left: matchedPending.row.line,
              right: row.line,
            });
            splitRows.push(...matchedPending.auxiliaryRows);
          }
          lastLineDestination = { kind: "direct" };
        } else {
          flushLeadingUnpairedDeleted();
          splitRows.push({
            kind: "pair",
            key: row.key,
            left: null,
            right: row.line,
          });
          lastLineDestination = { kind: "direct" };
        }
      } else {
        flushLeadingUnpairedDeleted();
        splitRows.push({
          kind: "pair",
          key: row.key,
          left: row.line.type === "add" ? null : row.line,
          right: row.line,
        });
        lastLineDestination = { kind: "direct" };
      }
    }
  }

  flushAllPendingDeleted();

  return splitRows;
}

function splitFileContentLines(content: string): string[] {
  if (content.length === 0) {
    return [""];
  }

  const lines = content.split("\n");
  if (content.endsWith("\n")) {
    lines.pop();
  }
  return lines;
}

function buildFullFileRows(
  file: DiffFile,
  fullFileContent: string | null | undefined,
  comments: Map<string, ReviewComment[]>,
  annotations: Map<string, Annotation[]>,
  composerRange: CommentRange | null,
  aiSuggestions?: Map<string, AiSuggestion[]>,
): FlatRow[] | null {
  if (fullFileContent === null || fullFileContent === undefined) {
    return null;
  }

  const rows: FlatRow[] = [];
  const filePath = getDiffFilePath(file);
  const fileLines = splitFileContentLines(fullFileContent);
  const renderedNewLines = new Map<number, FlatLineEntry>();
  const removedBeforeNewLine = new Map<number, FlatLineEntry[]>();

  const appendRemovedLines = (anchorLine: number, removedLines: FlatLineEntry[]) => {
    if (removedLines.length === 0) {
      return;
    }
    const existing = removedBeforeNewLine.get(anchorLine) ?? [];
    existing.push(...removedLines);
    removedBeforeNewLine.set(anchorLine, existing);
  };

  for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex++) {
    const hunk = file.hunks[hunkIndex];
    if (hunk) {
      let newLineTracker = hunk.newStart;
      let pendingRemoved: FlatLineEntry[] = [];

      for (let lineIndex = 0; lineIndex < hunk.lines.length; lineIndex++) {
        const line = hunk.lines[lineIndex];
        if (line && line.type !== "hunk-header") {
          const lineKey = `full-${hunkIndex}-${lineIndex}-${line.type}-${line.oldLineNumber ?? "x"}-${line.newLineNumber ?? "x"}`;
          const lineEntry: FlatLineEntry = {
            key: lineKey,
            line: {
              ...line,
              pairKey: line.pairId === undefined ? null : `pair-${hunkIndex}-${line.pairId}`,
            },
          };

          if (line.type === "del") {
            pendingRemoved.push(lineEntry);
          } else {
            appendRemovedLines(newLineTracker, pendingRemoved);
            pendingRemoved = [];
            renderedNewLines.set(newLineTracker, lineEntry);
            newLineTracker++;
          }
        }
      }

      appendRemovedLines(newLineTracker, pendingRemoved);
    }
  }

  for (let lineIndex = 0; lineIndex < fileLines.length; lineIndex++) {
    const lineNumber = lineIndex + 1;
    const removedLines = removedBeforeNewLine.get(lineNumber);
    if (removedLines) {
      for (const removedLine of removedLines) {
        appendLineRows(
          rows,
          filePath,
          removedLine,
          comments,
          annotations,
          composerRange,
          aiSuggestions,
        );
      }
    }

    const existingLine = renderedNewLines.get(lineNumber);
    const lineEntry =
      existingLine ??
      ({
        key: `full-context-${lineNumber}`,
        line: {
          type: "context",
          content: fileLines[lineIndex] ?? "",
          oldLineNumber: lineNumber,
          newLineNumber: lineNumber,
          pairKey: null,
        },
      } satisfies FlatLineEntry);

    appendLineRows(rows, filePath, lineEntry, comments, annotations, composerRange, aiSuggestions);
  }

  const trailingRemoved = removedBeforeNewLine.get(fileLines.length + 1);
  if (trailingRemoved) {
    for (const removedLine of trailingRemoved) {
      appendLineRows(
        rows,
        filePath,
        removedLine,
        comments,
        annotations,
        composerRange,
        aiSuggestions,
      );
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------

function countMatchesInText(text: string, query: string): number {
  if (!query) {
    return 0;
  }
  const q = query.toLowerCase();
  const lower = text.toLowerCase();
  let count = 0;
  let idx = lower.indexOf(q);
  while (idx !== -1) {
    count++;
    idx = lower.indexOf(q, idx + 1);
  }
  return count;
}

// ---------------------------------------------------------------------------
// DiffViewer
// ---------------------------------------------------------------------------

export function DiffViewer({
  file,
  highlighter,
  language,
  comments = new Map(),
  annotations = new Map(),
  prNumber,
  activeComposer,
  onCommentRange,
  onCloseComposer,
  fullFileContent,
  diffMode = "unified",
  resolvedThreadIds,
  reviewCommentReactions,
  aiSuggestions,
  reviewActionsEnabled = true,
  bottomOverlayInset = 0,
  onPostSuggestion,
  onDismissSuggestion,
}: DiffViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { codeThemeDark, codeThemeLight, resolvedTheme } = useTheme();
  const shikiTheme = useMemo(
    () => ({ light: codeThemeLight, dark: codeThemeDark }),
    [codeThemeDark, codeThemeLight],
  );

  // --- Scroll position persistence (per file) ---
  const scrollKey = `dispatch-scroll:${getDiffFilePath(file)}`;
  // Restore saved scroll position on mount
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const saved = sessionStorage.getItem(scrollKey);
    if (saved) {
      el.scrollTop = Number(saved);
    }
    // Save scroll position on unmount
    return () => {
      sessionStorage.setItem(scrollKey, String(el.scrollTop));
    };
  }, [scrollKey]);

  // --- Search state ---
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeSearchRef = useRef<HTMLSpanElement>(null);

  // --- Drag-to-select state ---
  const selectingFromRef = useRef<CommentTarget | null>(null);
  const hoverLineRef = useRef<CommentTarget | null>(null);
  const [selectingFrom, setSelectingFrom] = useState<CommentTarget | null>(null);
  const [hoverLine, setHoverLine] = useState<CommentTarget | null>(null);

  const selectionRange = useMemo<{ side: CommentSide; start: number; end: number } | null>(() => {
    if (selectingFrom !== null && hoverLine !== null && selectingFrom.side === hoverLine.side) {
      return {
        side: selectingFrom.side,
        start: Math.min(selectingFrom.line, hoverLine.line),
        end: Math.max(selectingFrom.line, hoverLine.line),
      };
    }
    if (activeComposer) {
      return {
        side: activeComposer.side,
        start: activeComposer.startLine,
        end: activeComposer.endLine,
      };
    }
    return null;
  }, [selectingFrom, hoverLine, activeComposer]);

  // Global mouseUp to commit selection
  useEffect(() => {
    function handleMouseUp() {
      if (selectingFromRef.current !== null) {
        const from = selectingFromRef.current;
        const to = hoverLineRef.current ?? from;
        selectingFromRef.current = null;
        hoverLineRef.current = null;
        setSelectingFrom(null);
        setHoverLine(null);
        if (from.side === to.side) {
          onCommentRange?.({
            startLine: Math.min(from.line, to.line),
            endLine: Math.max(from.line, to.line),
            side: from.side,
          });
        }
      }
    }
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onCommentRange]);

  const handleStartSelect = useCallback((target: CommentTarget) => {
    selectingFromRef.current = target;
    hoverLineRef.current = target;
    setSelectingFrom(target);
    setHoverLine(target);
  }, []);

  const handleLineHover = useCallback((target: CommentTarget) => {
    if (selectingFromRef.current !== null && selectingFromRef.current.side === target.side) {
      hoverLineRef.current = target;
      setHoverLine(target);
    }
  }, []);

  const handleGutterClick = useCallback(
    (target: CommentTarget, shiftKey: boolean) => {
      if (shiftKey && activeComposer && activeComposer.side === target.side) {
        const allLines = [activeComposer.startLine, activeComposer.endLine, target.line];
        onCommentRange?.({
          startLine: Math.min(...allLines),
          endLine: Math.max(...allLines),
          side: target.side,
        });
        return;
      }
      onCommentRange?.({ startLine: target.line, endLine: target.line, side: target.side });
    },
    [activeComposer, onCommentRange],
  );

  // --- Build rows ---
  const rows = useMemo(
    () => buildRows(file, comments, annotations, activeComposer ?? null, aiSuggestions),
    [file, comments, annotations, activeComposer, aiSuggestions],
  );

  const fullFileModeRows = useMemo(
    () =>
      buildFullFileRows(
        file,
        fullFileContent,
        comments,
        annotations,
        activeComposer ?? null,
        aiSuggestions,
      ),
    [file, fullFileContent, comments, annotations, activeComposer, aiSuggestions],
  );

  const activeRows =
    diffMode === "full-file" && fullFileModeRows !== null ? fullFileModeRows : rows;
  const commentingEnabled = reviewActionsEnabled && Boolean(onCommentRange);

  // --- Search match counting (must be after rows) ---
  const totalSearchMatches = useMemo(() => {
    if (!searchQuery) {
      return 0;
    }
    let count = 0;
    for (const row of activeRows) {
      if (row.kind === "line" && row.line.type !== "hunk-header") {
        count += countMatchesInText(row.line.content, searchQuery);
      }
    }
    return count;
  }, [searchQuery, activeRows]);

  // Clamp match index inline (derived state, no effect needed)
  const clampedMatchIndex = totalSearchMatches > 0 ? searchMatchIndex % totalSearchMatches : 0;

  // Scroll active match into view
  useEffect(() => {
    if (activeSearchRef.current) {
      activeSearchRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [clampedMatchIndex, searchQuery]);

  // Cmd+F to open search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
    }
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (activeRows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-text-tertiary text-xs">No changes in this file</p>
      </div>
    );
  }

  const filePath = getDiffFilePath(file);
  const isDragging = selectingFrom !== null;

  return (
    <div
      ref={scrollRef}
      className={`bg-bg-root relative flex-1 overflow-auto ${isDragging ? "select-none" : ""}`}
      style={{
        paddingBottom: bottomOverlayInset,
        scrollPaddingBottom: bottomOverlayInset,
      }}
      tabIndex={-1}
    >
      {/* Search bar — floating overlay top-right */}
      {searchOpen && (
        <div className="border-border bg-bg-elevated sticky top-0 right-0 z-10 ml-auto flex w-80 max-w-full items-center gap-1.5 rounded-bl-md border-b border-l px-3 py-1.5 shadow-lg">
          <Search
            size={13}
            className="text-text-tertiary shrink-0"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchMatchIndex(0);
            }}
            placeholder="Find in diff..."
            className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-xs focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchOpen(false);
                setSearchQuery("");
              }
              if (e.key === "Enter") {
                if (e.shiftKey) {
                  setSearchMatchIndex((i) => (i > 0 ? i - 1 : totalSearchMatches - 1));
                } else {
                  setSearchMatchIndex((i) => (i < totalSearchMatches - 1 ? i + 1 : 0));
                }
              }
            }}
          />
          {searchQuery && totalSearchMatches > 0 && (
            <>
              <span className="text-text-tertiary font-mono text-[10px]">
                {clampedMatchIndex + 1}/{totalSearchMatches}
              </span>
              <button
                type="button"
                onClick={() => setSearchMatchIndex((i) => (i > 0 ? i - 1 : totalSearchMatches - 1))}
                className="text-text-tertiary hover:text-text-primary cursor-pointer p-0.5"
              >
                <ChevronUp size={12} />
              </button>
              <button
                type="button"
                onClick={() => setSearchMatchIndex((i) => (i < totalSearchMatches - 1 ? i + 1 : 0))}
                className="text-text-tertiary hover:text-text-primary cursor-pointer p-0.5"
              >
                <ChevronDown size={12} />
              </button>
            </>
          )}
          {searchQuery && totalSearchMatches === 0 && (
            <span className="text-text-ghost text-[10px]">No results</span>
          )}
          <button
            type="button"
            onClick={() => {
              setSearchOpen(false);
              setSearchQuery("");
            }}
            className="text-text-tertiary hover:text-text-primary cursor-pointer p-0.5"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {diffMode === "split" ? (
        /* Split diff mode */
        <SplitDiffView
          rows={rows}
          highlighter={highlighter ?? null}
          language={language ?? "text"}
          shikiTheme={shikiTheme}
          resolvedTheme={resolvedTheme}
          filePath={filePath}
          prNumber={prNumber}
          reviewActionsEnabled={reviewActionsEnabled}
          resolvedThreadIds={resolvedThreadIds}
          reviewCommentReactions={reviewCommentReactions}
          onPostSuggestion={onPostSuggestion}
          onDismissSuggestion={onDismissSuggestion}
          onCloseComposer={onCloseComposer}
        />
      ) : (
        /* Unified diff mode — plain DOM (like Better Hub, one file at a time) */
        <UnifiedDiffView
          rows={activeRows}
          highlighter={highlighter ?? null}
          language={language ?? "text"}
          shikiTheme={shikiTheme}
          resolvedTheme={resolvedTheme}
          filePath={filePath}
          prNumber={prNumber}
          selectionRange={selectionRange}
          activeComposer={activeComposer ?? null}
          isDragging={isDragging}
          searchQuery={searchQuery}
          searchMatchIndex={clampedMatchIndex}
          activeSearchRef={activeSearchRef}
          commentingEnabled={commentingEnabled}
          reviewActionsEnabled={reviewActionsEnabled}
          onStartSelect={handleStartSelect}
          onLineHover={handleLineHover}
          onGutterClick={handleGutterClick}
          onCloseComposer={onCloseComposer}
          resolvedThreadIds={resolvedThreadIds}
          reviewCommentReactions={reviewCommentReactions}
          onPostSuggestion={onPostSuggestion}
          onDismissSuggestion={onDismissSuggestion}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Split diff view (side-by-side)
// ---------------------------------------------------------------------------

function SplitDiffView({
  rows,
  highlighter,
  language,
  shikiTheme,
  resolvedTheme,
  filePath,
  prNumber,
  reviewActionsEnabled,
  resolvedThreadIds,
  reviewCommentReactions,
  onPostSuggestion,
  onDismissSuggestion,
  onCloseComposer,
}: {
  rows: FlatRow[];
  highlighter: Highlighter | null;
  language: string;
  shikiTheme: { light: string; dark: string };
  resolvedTheme: ThemeMode;
  filePath: string;
  prNumber?: number;
  reviewActionsEnabled: boolean;
  resolvedThreadIds?: Set<string>;
  reviewCommentReactions?: Record<string, GhReactionGroup[]>;
  onPostSuggestion?: (suggestion: AiSuggestion, body?: string) => Promise<void>;
  onDismissSuggestion?: (id: string) => void;
  onCloseComposer?: () => void;
}) {
  const splitRows = useMemo(() => buildSplitRows(rows), [rows]);

  return (
    <table className="w-full border-collapse font-mono text-[12.5px] leading-5">
      <colgroup>
        <col className="w-10" />
        <col />
        <col className="w-px" />
        <col className="w-10" />
        <col />
      </colgroup>
      <tbody>
        {splitRows.map((row) => {
          if (row.kind !== "pair") {
            const inlineRow = renderSupportingRow({
              row,
              prNumber,
              filePath,
              reviewActionsEnabled,
              resolvedThreadIds,
              reviewCommentReactions,
              onPostSuggestion,
              onDismissSuggestion,
              onCloseComposer,
            });
            if (!inlineRow) {
              return null;
            }

            return (
              <tr key={row.key}>
                <td
                  colSpan={5}
                  className="bg-bg-root p-0"
                >
                  {inlineRow}
                </td>
              </tr>
            );
          }

          if (row.left?.type === "hunk-header") {
            return (
              <tr key={row.key}>
                <td
                  colSpan={5}
                  className="border-border-subtle bg-diff-hunk-bg text-info h-6 border-y px-3 text-[11px]"
                >
                  {row.left.content}
                </td>
              </tr>
            );
          }

          return (
            <tr
              key={row.key}
              className="hover:brightness-110"
            >
              {/* Left side (old) */}
              <td
                className={`text-text-ghost border-r-border/40 border-r p-0 pr-2 text-right text-[11px] select-none ${
                  row.left?.type === "del" ? "bg-[rgba(239,100,97,0.04)]" : "bg-bg-root"
                }`}
              >
                <span className="flex h-5 items-center justify-end leading-5">
                  {row.left?.oldLineNumber ?? ""}
                </span>
              </td>
              <td className={`p-0 ${row.left?.type === "del" ? "bg-diff-del-bg" : ""}`}>
                <div className="flex h-5 items-center">
                  <span
                    className={`inline-flex w-5 shrink-0 items-center justify-center text-[11px] font-semibold select-none ${
                      row.left?.type === "del" ? "text-destructive/50" : "text-transparent"
                    }`}
                  >
                    {row.left?.type === "del" ? "-" : " "}
                  </span>
                  <span
                    className="text-text-primary flex-1 overflow-x-auto pr-2 pl-1 whitespace-pre"
                    style={{ tabSize: 4 }}
                  >
                    {row.left
                      ? renderLineContent(
                          row.left,
                          highlighter,
                          language,
                          resolvedTheme,
                          shikiTheme,
                        )
                      : ""}
                  </span>
                </div>
              </td>

              {/* Divider */}
              <td className="bg-border w-px p-0" />

              {/* Right side (new) */}
              <td
                className={`text-text-ghost border-r-border/40 border-r p-0 pr-2 text-right text-[11px] select-none ${
                  row.right?.type === "add" ? "bg-[rgba(61,214,140,0.04)]" : "bg-bg-root"
                }`}
              >
                <span className="flex h-5 items-center justify-end leading-5">
                  {row.right?.newLineNumber ?? ""}
                </span>
              </td>
              <td className={`p-0 ${row.right?.type === "add" ? "bg-diff-add-bg" : ""}`}>
                <div className="flex h-5 items-center">
                  <span
                    className={`inline-flex w-5 shrink-0 items-center justify-center text-[11px] font-semibold select-none ${
                      row.right?.type === "add" ? "text-success/50" : "text-transparent"
                    }`}
                  >
                    {row.right?.type === "add" ? "+" : " "}
                  </span>
                  <span
                    className="text-text-primary flex-1 overflow-x-auto pr-2 pl-1 whitespace-pre"
                    style={{ tabSize: 4 }}
                  >
                    {row.right
                      ? renderLineContent(
                          row.right,
                          highlighter,
                          language,
                          resolvedTheme,
                          shikiTheme,
                        )
                      : ""}
                  </span>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function renderLineContent(
  line: FlatLine,
  highlighter: Highlighter | null,
  language: string,
  resolvedTheme: ThemeMode,
  shikiTheme?: { light: string; dark: string },
): React.ReactNode {
  const themePair = shikiTheme ?? DEFAULT_SHIKI_THEME_PAIR;
  const hasWordDiff = Boolean(line.segments?.some((segment) => segment.type === "change"));
  const tokens =
    highlighter && language !== "text"
      ? safeTokenize(highlighter, line.content, language, resolvedTheme, themePair)
      : null;
  if (hasWordDiff && line.segments) {
    return tokens ? (
      <SyntaxSegmentedContent
        segments={line.segments}
        tokens={tokens}
        type={line.type}
        resolvedTheme={resolvedTheme}
      />
    ) : (
      <WordDiffContent
        segments={line.segments}
        type={line.type}
      />
    );
  }
  if (tokens) {
    return (
      <SyntaxContent
        tokens={tokens}
        resolvedTheme={resolvedTheme}
      />
    );
  }
  return line.content;
}

// ---------------------------------------------------------------------------
// Unified diff line row with search highlighting
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Unified diff view — plain DOM rendering (one file at a time, like Better Hub)
// ---------------------------------------------------------------------------

function UnifiedDiffView({
  rows,
  highlighter,
  language,
  shikiTheme,
  resolvedTheme,
  filePath,
  prNumber,
  selectionRange,
  activeComposer,
  isDragging,
  searchQuery,
  searchMatchIndex,
  activeSearchRef,
  commentingEnabled,
  reviewActionsEnabled,
  onStartSelect,
  onLineHover,
  onGutterClick,
  onCloseComposer,
  resolvedThreadIds,
  reviewCommentReactions,
  onPostSuggestion,
  onDismissSuggestion,
}: {
  rows: FlatRow[];
  highlighter: Highlighter | null;
  language: string;
  shikiTheme: { light: string; dark: string };
  resolvedTheme: ThemeMode;
  filePath: string;
  prNumber?: number;
  selectionRange: { side: CommentSide; start: number; end: number } | null;
  activeComposer: CommentRange | null;
  isDragging: boolean;
  searchQuery: string;
  searchMatchIndex: number;
  activeSearchRef: React.RefObject<HTMLSpanElement | null>;
  commentingEnabled: boolean;
  reviewActionsEnabled: boolean;
  onStartSelect: (target: CommentTarget) => void;
  onLineHover: (target: CommentTarget) => void;
  onGutterClick: (target: CommentTarget, shiftKey: boolean) => void;
  onCloseComposer?: () => void;
  resolvedThreadIds?: Set<string>;
  reviewCommentReactions?: Record<string, GhReactionGroup[]>;
  onPostSuggestion?: (suggestion: AiSuggestion, body?: string) => Promise<void>;
  onDismissSuggestion?: (id: string) => void;
}) {
  // Precompute search match offsets for all rows
  const searchMatchOffsets = useMemo(() => {
    const offsets: number[] = [];
    let total = 0;
    for (const row of rows) {
      offsets.push(total);
      if (row.kind === "line" && row.line.type !== "hunk-header" && searchQuery) {
        total += countMatchesInText(row.line.content, searchQuery);
      }
    }
    return offsets;
  }, [rows, searchQuery]);

  return (
    <div className="w-full font-mono text-[12.5px] leading-5">
      {rows.map((row, index) => {
        if (row.kind === "line") {
          const commentTarget = getCommentTarget(row.line);
          const lineNum = commentTarget?.line ?? null;
          const isSelected =
            selectionRange !== null &&
            lineNum !== null &&
            commentTarget?.side === selectionRange.side &&
            lineNum >= selectionRange.start &&
            lineNum <= selectionRange.end;

          return (
            <DiffLineRow
              key={row.key}
              line={row.line}
              highlighter={highlighter}
              language={language}
              shikiTheme={shikiTheme}
              resolvedTheme={resolvedTheme}
              filePath={filePath}
              commentingEnabled={commentingEnabled}
              onStartSelect={onStartSelect}
              onLineHover={onLineHover}
              onGutterClick={onGutterClick}
              isSelected={isSelected}
              isDragging={isDragging}
              isComposerActive={
                activeComposer !== null &&
                lineNum !== null &&
                commentTarget?.side === activeComposer.side &&
                lineNum >= activeComposer.startLine &&
                lineNum <= activeComposer.endLine
              }
              searchQuery={searchQuery}
              searchMatchOffset={searchMatchOffsets[index] ?? 0}
              activeSearchIndex={searchMatchIndex}
              activeSearchRef={activeSearchRef}
            />
          );
        }

        return renderSupportingRow({
          row,
          prNumber,
          filePath,
          reviewActionsEnabled,
          resolvedThreadIds,
          reviewCommentReactions,
          onPostSuggestion,
          onDismissSuggestion,
          onCloseComposer,
        });
      })}
    </div>
  );
}

function renderSupportingRow({
  row,
  prNumber,
  filePath,
  reviewActionsEnabled,
  resolvedThreadIds,
  reviewCommentReactions,
  onPostSuggestion,
  onDismissSuggestion,
  onCloseComposer,
}: {
  row: NonLineFlatRow;
  prNumber?: number;
  filePath: string;
  reviewActionsEnabled: boolean;
  resolvedThreadIds?: Set<string>;
  reviewCommentReactions?: Record<string, GhReactionGroup[]>;
  onPostSuggestion?: (suggestion: AiSuggestion, body?: string) => Promise<void>;
  onDismissSuggestion?: (id: string) => void;
  onCloseComposer?: () => void;
}) {
  if (row.kind === "comment") {
    return (
      <InlineComment
        key={row.key}
        comments={row.comments}
        prNumber={prNumber}
        reviewActionsEnabled={reviewActionsEnabled}
        resolvedThreadIds={resolvedThreadIds}
        reviewCommentReactions={reviewCommentReactions}
      />
    );
  }

  if (row.kind === "annotation") {
    return (
      <CiAnnotation
        key={row.key}
        annotations={row.annotations}
      />
    );
  }

  if (row.kind === "ai-suggestion" && onPostSuggestion && onDismissSuggestion) {
    return (
      <AiSuggestionGroup
        key={row.key}
        suggestions={row.suggestions}
        onPost={onPostSuggestion}
        onDismiss={onDismissSuggestion}
      />
    );
  }

  if (row.kind === "composer" && prNumber && onCloseComposer) {
    return (
      <CommentComposer
        key={row.key}
        prNumber={prNumber}
        filePath={filePath}
        line={row.endLine}
        side={row.side}
        startLine={row.startLine === row.endLine ? undefined : row.startLine}
        onClose={onCloseComposer}
      />
    );
  }

  return null;
}

function DiffLineRow({
  line,
  highlighter,
  language,
  shikiTheme,
  resolvedTheme,
  filePath,
  commentingEnabled,
  onStartSelect,
  onLineHover,
  onGutterClick,
  isSelected,
  isDragging,
  isComposerActive,
  searchQuery,
  searchMatchOffset,
  activeSearchIndex,
  activeSearchRef,
}: {
  line: FlatLine;
  highlighter: Highlighter | null;
  language: string;
  shikiTheme: { light: string; dark: string };
  resolvedTheme: ThemeMode;
  filePath: string;
  commentingEnabled: boolean;
  onStartSelect: (target: CommentTarget) => void;
  onLineHover: (target: CommentTarget) => void;
  onGutterClick: (target: CommentTarget, shiftKey: boolean) => void;
  isSelected: boolean;
  isDragging: boolean;
  isComposerActive?: boolean;
  searchQuery: string;
  searchMatchOffset: number;
  activeSearchIndex: number;
  activeSearchRef: React.RefObject<HTMLSpanElement | null>;
}) {
  if (line.type === "hunk-header") {
    return (
      <div className="border-border-subtle bg-diff-hunk-bg text-info flex h-6 items-center border-y px-3 text-[11px]">
        {line.content}
      </div>
    );
  }

  const hasWordDiff = Boolean(line.segments?.some((segment) => segment.type === "change"));
  const wordSegments = hasWordDiff ? (line.segments ?? null) : null;

  const tokens =
    highlighter && language !== "text"
      ? safeTokenize(highlighter, line.content, language, resolvedTheme, shikiTheme)
      : null;

  const commentTarget = getCommentTarget(line);
  const lineNum = commentTarget?.line ?? null;
  const canCommentOnLine = commentingEnabled && commentTarget !== null;
  const blameLine = line.newLineNumber;
  const showBlameButton = blameLine !== null && line.type !== "del";
  const showLineActions = showBlameButton || (canCommentOnLine && !isComposerActive);

  const rowBg = isSelected
    ? "!bg-[rgba(155,149,144,0.08)]"
    : line.type === "add"
      ? "bg-diff-add-bg"
      : line.type === "del"
        ? "bg-diff-del-bg"
        : "";

  const barColor = isSelected
    ? "bg-text-secondary"
    : line.type === "add"
      ? "bg-success"
      : line.type === "del"
        ? "bg-destructive"
        : "";

  return (
    <div
      className={`group/line flex ${rowBg} transition-[filter] duration-75 ${
        !isSelected && !isDragging ? "hover:brightness-110" : ""
      }`}
      onMouseEnter={() => {
        if (commentingEnabled && commentTarget) {
          onLineHover(commentTarget);
        }
      }}
    >
      {/* Color bar — subtle accent inset on hover */}
      <div
        className={`sticky left-0 z-[1] w-[3px] shrink-0 ${barColor} group-hover/line:shadow-[inset_2px_0_0_rgba(212,136,58,0.15)]`}
      />
      {/* Line number gutter */}
      <div
        className={`sticky left-[3px] z-[1] w-14 shrink-0 border-r pr-2 text-right text-[11px] select-none ${
          isSelected
            ? "border-r-text-secondary/20 text-text-secondary bg-[rgba(155,149,144,0.04)]"
            : line.type === "add"
              ? "border-r-success/10 text-text-ghost bg-[rgba(61,214,140,0.04)]"
              : line.type === "del"
                ? "border-r-destructive/10 text-text-ghost bg-[rgba(239,100,97,0.04)]"
                : "border-r-border/40 bg-bg-root text-text-ghost"
        }`}
      >
        <div className="relative flex h-5 items-center justify-end">
          {showLineActions && (
            <div className="pointer-events-none absolute top-1/2 left-1 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-focus-within/line:pointer-events-auto group-focus-within/line:opacity-100 group-hover/line:pointer-events-auto group-hover/line:opacity-100">
              {canCommentOnLine && !isComposerActive && (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (commentTarget) {
                      onStartSelect(commentTarget);
                    }
                  }}
                  onClick={(e) => {
                    if (commentTarget) {
                      onGutterClick(commentTarget, e.shiftKey);
                    }
                  }}
                  className={lineActionButtonClassName}
                  tabIndex={-1}
                  aria-label={`Comment on line ${lineNum}`}
                >
                  <Plus
                    size={11}
                    strokeWidth={2.5}
                  />
                </button>
              )}

              {showBlameButton && blameLine !== null && (
                <BlameButton
                  className={lineActionButtonClassName}
                  file={filePath}
                  gitRef="HEAD"
                  line={blameLine}
                />
              )}
            </div>
          )}
          <span className="leading-5">
            {line.type === "del" ? line.oldLineNumber : line.newLineNumber}
          </span>
        </div>
      </div>
      {/* Code content */}
      <div className="flex h-5 min-w-0 flex-1 items-center">
        <span
          className={`inline-flex w-5 shrink-0 items-center justify-center text-[11px] font-semibold select-none ${
            line.type === "add"
              ? "text-success/50"
              : line.type === "del"
                ? "text-destructive/50"
                : "text-transparent"
          }`}
        >
          {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
        </span>
        <span
          className="text-text-primary flex-1 overflow-x-auto pr-3 pl-1 whitespace-pre"
          style={{ tabSize: 4 }}
        >
          {wordSegments ? (
            tokens ? (
              <SyntaxSegmentedContent
                segments={wordSegments}
                tokens={tokens}
                type={line.type}
                resolvedTheme={resolvedTheme}
              />
            ) : (
              <WordDiffContent
                segments={wordSegments}
                type={line.type}
              />
            )
          ) : searchQuery ? (
            <SearchHighlightedContent
              text={line.content}
              tokens={tokens}
              query={searchQuery}
              matchOffset={searchMatchOffset}
              activeIndex={activeSearchIndex}
              activeRef={activeSearchRef}
              resolvedTheme={resolvedTheme}
            />
          ) : tokens ? (
            <SyntaxContent
              tokens={tokens}
              resolvedTheme={resolvedTheme}
            />
          ) : (
            line.content
          )}
        </span>
      </div>
    </div>
  );
}

const lineActionButtonClassName = cn(
  "border-border bg-bg-raised text-text-tertiary flex h-4 w-4 items-center justify-center rounded-sm border shadow-sm transition-colors",
  "hover:border-border-strong hover:bg-bg-elevated hover:text-accent-text",
  "focus-visible:border-border-accent focus-visible:bg-accent-muted focus-visible:text-accent-text focus-visible:outline-none",
);

// ---------------------------------------------------------------------------
// Search-highlighted content (overlays on plain text or tokens)
// ---------------------------------------------------------------------------

function SearchHighlightedContent({
  text,
  tokens,
  query,
  matchOffset,
  activeIndex,
  activeRef,
  resolvedTheme,
}: {
  text: string;
  tokens: ShikiToken[] | null;
  query: string;
  matchOffset: number;
  activeIndex: number;
  activeRef: React.RefObject<HTMLSpanElement | null>;
  resolvedTheme: ThemeMode;
}) {
  const q = query.toLowerCase();
  let globalIdx = matchOffset;

  // If we have syntax tokens, highlight within each token
  if (tokens) {
    return (
      <>
        {tokens.map((token, i) => {
          const parts: React.ReactNode[] = [];
          let remaining = token.content;
          let lower = remaining.toLowerCase();
          let matchPos = lower.indexOf(q);
          let partKey = 0;

          while (matchPos !== -1) {
            if (matchPos > 0) {
              parts.push(
                <span
                  key={`${i}-${partKey++}`}
                  style={{ color: getShikiTokenColor(token, resolvedTheme) }}
                >
                  {remaining.slice(0, matchPos)}
                </span>,
              );
            }
            const isActive = globalIdx === activeIndex;
            parts.push(
              <span
                key={`${i}-${partKey++}`}
                ref={isActive ? activeRef : undefined}
                className={`rounded-xs ${
                  isActive ? "bg-primary text-bg-root" : "bg-warning/40 text-text-primary"
                }`}
              >
                {remaining.slice(matchPos, matchPos + q.length)}
              </span>,
            );
            globalIdx++;
            remaining = remaining.slice(matchPos + q.length);
            lower = remaining.toLowerCase();
            matchPos = lower.indexOf(q);
          }
          if (remaining) {
            parts.push(
              <span
                key={`${i}-${partKey++}`}
                style={{ color: getShikiTokenColor(token, resolvedTheme) }}
              >
                {remaining}
              </span>,
            );
          }
          return parts;
        })}
      </>
    );
  }

  // Plain text fallback
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let lower = remaining.toLowerCase();
  let matchPos = lower.indexOf(q);
  let partKey = 0;

  while (matchPos !== -1) {
    if (matchPos > 0) {
      parts.push(<span key={partKey++}>{remaining.slice(0, matchPos)}</span>);
    }
    const isActive = globalIdx === activeIndex;
    parts.push(
      <span
        key={partKey++}
        ref={isActive ? activeRef : undefined}
        className={`rounded-xs ${
          isActive ? "bg-primary text-bg-root" : "bg-warning/40 text-text-primary"
        }`}
      >
        {remaining.slice(matchPos, matchPos + q.length)}
      </span>,
    );
    globalIdx++;
    remaining = remaining.slice(matchPos + q.length);
    lower = remaining.toLowerCase();
    matchPos = lower.indexOf(q);
  }
  if (remaining) {
    parts.push(<span key={partKey++}>{remaining}</span>);
  }
  return <>{parts}</>;
}

// ---------------------------------------------------------------------------
// Syntax highlighted content
// ---------------------------------------------------------------------------

const SHIKI_TOKEN_CACHE_LIMIT = 500;
const shikiTokenCache = new Map<string, ShikiToken[] | null>();

function getShikiTokenCacheKey(
  content: string,
  lang: string,
  shikiTheme: { light: string; dark: string },
): string {
  return `${shikiTheme.dark}|${shikiTheme.light}|${lang}|${content}`;
}

function setShikiTokenCache(key: string, tokens: ShikiToken[] | null): void {
  if (!shikiTokenCache.has(key) && shikiTokenCache.size >= SHIKI_TOKEN_CACHE_LIMIT) {
    const oldest = shikiTokenCache.keys().next().value;
    if (oldest !== undefined) {
      shikiTokenCache.delete(oldest);
    }
  }
  shikiTokenCache.set(key, tokens);
}

function safeTokenize(
  highlighter: Highlighter,
  content: string,
  lang: string,
  resolvedTheme: ThemeMode,
  shikiTheme?: { light: string; dark: string },
): ShikiToken[] | null {
  const themePair = shikiTheme ?? DEFAULT_SHIKI_THEME_PAIR;
  const cacheKey = getShikiTokenCacheKey(content, lang, themePair);
  const cached = shikiTokenCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const loadedLangs = highlighter.getLoadedLanguages();
    if (!loadedLangs.includes(lang)) {
      setShikiTokenCache(cacheKey, null);
      return null;
    }
    const result = (() => {
      try {
        return highlighter.codeToTokens(content, {
          lang: lang as Parameters<Highlighter["codeToTokens"]>[1]["lang"],
          themes: {
            light: themePair.light,
            dark: themePair.dark,
          } as Parameters<Highlighter["codeToTokens"]>[1]["themes"],
        } as Parameters<Highlighter["codeToTokens"]>[1]);
      } catch {
        return highlighter.codeToTokens(content, {
          lang: lang as Parameters<Highlighter["codeToTokens"]>[1]["lang"],
          theme: themePair[resolvedTheme],
        } as Parameters<Highlighter["codeToTokens"]>[1]);
      }
    })();
    const tokens = (result.tokens[0] as ShikiToken[] | undefined) ?? null;
    setShikiTokenCache(cacheKey, tokens);
    return tokens;
  } catch {
    setShikiTokenCache(cacheKey, null);
    return null;
  }
}

function SyntaxContent({
  tokens,
  resolvedTheme,
}: {
  tokens: ShikiToken[];
  resolvedTheme: ThemeMode;
}) {
  return (
    <>
      {tokens.map((token, i) => (
        <span
          key={`${i}-${token.content.slice(0, 5)}`}
          style={{ color: getShikiTokenColor(token, resolvedTheme) }}
        >
          {token.content}
        </span>
      ))}
    </>
  );
}

function SyntaxSegmentedContent({
  segments,
  tokens,
  type,
  resolvedTheme,
}: {
  segments: Segment[];
  tokens: ShikiToken[];
  type: "add" | "del" | "context" | "hunk-header";
  resolvedTheme: ThemeMode;
}) {
  const result: {
    text: string;
    highlight: boolean;
    color?: string;
  }[] = [];

  let segIdx = 0;
  let segOffset = 0;
  let tokIdx = 0;
  let tokOffset = 0;

  while (segIdx < segments.length && tokIdx < tokens.length) {
    const segment = segments[segIdx];
    const token = tokens[tokIdx];
    if (!segment || !token) {
      break;
    }

    const segmentRemaining = segment.text.length - segOffset;
    const tokenRemaining = token.content.length - tokOffset;
    const take = Math.min(segmentRemaining, tokenRemaining);

    if (take > 0) {
      result.push({
        text: token.content.slice(tokOffset, tokOffset + take),
        highlight: segment.type === "change",
        color: getShikiTokenColor(token, resolvedTheme),
      });
    }

    segOffset += take;
    tokOffset += take;

    if (segOffset >= segment.text.length) {
      segIdx++;
      segOffset = 0;
    }
    if (tokOffset >= token.content.length) {
      tokIdx++;
      tokOffset = 0;
    }
  }

  while (tokIdx < tokens.length) {
    const token = tokens[tokIdx];
    if (!token) {
      break;
    }
    const remaining = token.content.slice(tokOffset);
    if (remaining) {
      result.push({
        text: remaining,
        highlight: false,
        color: getShikiTokenColor(token, resolvedTheme),
      });
    }
    tokIdx++;
    tokOffset = 0;
  }

  while (segIdx < segments.length) {
    const segment = segments[segIdx];
    if (!segment) {
      break;
    }
    const remaining = segment.text.slice(segOffset);
    if (remaining) {
      result.push({
        text: remaining,
        highlight: segment.type === "change",
      });
    }
    segIdx++;
    segOffset = 0;
  }

  return (
    <>
      {result.map((segment, i) => (
        <span
          key={`${i}-${segment.text.slice(0, 5)}`}
          style={{ color: segment.color }}
          className={
            segment.highlight
              ? type === "add"
                ? "bg-diff-add-word -mx-px rounded-[2px] px-px"
                : "bg-diff-del-word -mx-px rounded-[2px] px-px"
              : undefined
          }
        >
          {segment.text}
        </span>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Word-level diff highlighting
// ---------------------------------------------------------------------------

function WordDiffContent({
  segments,
  type,
}: {
  segments: Segment[];
  type: "add" | "del" | "context" | "hunk-header";
}) {
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "change") {
          return (
            <span
              key={`${i}-${seg.text.slice(0, 5)}`}
              className={`-mx-px rounded-[2px] px-px ${
                type === "add" ? "bg-diff-add-word" : "bg-diff-del-word"
              }`}
            >
              {seg.text}
            </span>
          );
        }
        return <span key={`${i}-${seg.text.slice(0, 5)}`}>{seg.text}</span>;
      })}
    </>
  );
}
