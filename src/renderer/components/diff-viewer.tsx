import type { Highlighter } from "shiki";

import { ChevronDown, ChevronUp, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  computeWordDiff,
  getDiffFilePath,
  type DiffFile,
  type DiffLine,
  type Segment,
} from "../lib/diff-parser";
import { useTheme } from "../lib/theme-context";
import { BlamePopover, useBlameHover } from "./blame-popover";
import { CiAnnotation, type Annotation } from "./ci-annotation";
import { CommentComposer } from "./comment-composer";
import { InlineComment, type ReviewComment } from "./inline-comment";

/**
 * Table-based diff viewer with:
 * - Cmd+F search with match highlighting + navigation
 * - Multi-line drag-to-select for comments
 * - Full-file mode (shows entire file with changes highlighted)
 * - Split/side-by-side diff mode
 */

export interface CommentRange {
  startLine: number;
  endLine: number;
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
  reviewCommentReactions?: Record<string, import("@/shared/ipc").GhReactionGroup[]>;
}

// ---------------------------------------------------------------------------
// Flat row model
// ---------------------------------------------------------------------------

type FlatLine = DiffLine & { pairIndex: number | null };

type FlatRow =
  | { kind: "line"; key: string; line: FlatLine }
  | { kind: "comment"; key: string; comments: ReviewComment[] }
  | { kind: "annotation"; key: string; annotations: Annotation[] }
  | { kind: "composer"; key: string; startLine: number; endLine: number };

function buildRows(
  file: DiffFile,
  comments: Map<string, ReviewComment[]>,
  annotations: Map<string, Annotation[]>,
  composerRange: CommentRange | null,
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
        pairIndex: null,
      },
    });

    for (let i = 0; i < hunk.lines.length; i++) {
      const line = hunk.lines[i]!;
      const next = hunk.lines[i + 1];

      let pairIndex: number | null = null;
      if (line.type === "del" && next?.type === "add") {
        pairIndex = rows.length + 1;
      } else if (line.type === "add" && i > 0 && hunk.lines[i - 1]?.type === "del") {
        pairIndex = rows.length - 1;
      }

      const lineNum = line.newLineNumber ?? line.oldLineNumber;
      const lineKey = `${line.type}-${line.oldLineNumber ?? "x"}-${line.newLineNumber ?? "x"}`;
      rows.push({ kind: "line", key: lineKey, line: { ...line, pairIndex } });

      if (lineNum) {
        const posKey = `${filePath}:${lineNum}`;

        const lineAnnotations = annotations.get(posKey);
        if (lineAnnotations && lineAnnotations.length > 0) {
          rows.push({ kind: "annotation", key: `ann-${posKey}`, annotations: lineAnnotations });
        }

        const lineComments = comments.get(posKey);
        if (lineComments && lineComments.length > 0) {
          rows.push({ kind: "comment", key: `cmt-${posKey}`, comments: lineComments });
        }
      }

      if (composerRange && lineNum === composerRange.endLine) {
        rows.push({
          kind: "composer",
          key: `composer-${composerRange.startLine}-${composerRange.endLine}`,
          startLine: composerRange.startLine,
          endLine: composerRange.endLine,
        });
      }
    }
    hunkIndex++;
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
}: DiffViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { hoveredLine, anchorRect, onLineEnter, onLineLeave } = useBlameHover();
  const { codeTheme: shikiTheme } = useTheme();

  // --- Search state ---
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeSearchRef = useRef<HTMLSpanElement>(null);

  // --- Drag-to-select state ---
  const selectingFromRef = useRef<number | null>(null);
  const hoverLineRef = useRef<number | null>(null);
  const [selectingFrom, setSelectingFrom] = useState<number | null>(null);
  const [hoverLine, setHoverLine] = useState<number | null>(null);

  const selectionRange = useMemo(() => {
    if (selectingFrom !== null && hoverLine !== null) {
      return {
        start: Math.min(selectingFrom, hoverLine),
        end: Math.max(selectingFrom, hoverLine),
      };
    }
    if (activeComposer) {
      return { start: activeComposer.startLine, end: activeComposer.endLine };
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
        onCommentRange?.({
          startLine: Math.min(from, to),
          endLine: Math.max(from, to),
        });
      }
    }
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onCommentRange]);

  const handleStartSelect = useCallback((lineNum: number) => {
    selectingFromRef.current = lineNum;
    hoverLineRef.current = lineNum;
    setSelectingFrom(lineNum);
    setHoverLine(lineNum);
  }, []);

  const handleLineHover = useCallback((lineNum: number) => {
    if (selectingFromRef.current !== null) {
      hoverLineRef.current = lineNum;
      setHoverLine(lineNum);
    }
  }, []);

  const handleGutterClick = useCallback(
    (lineNum: number, shiftKey: boolean) => {
      if (shiftKey && activeComposer) {
        const allLines = [activeComposer.startLine, activeComposer.endLine, lineNum];
        onCommentRange?.({
          startLine: Math.min(...allLines),
          endLine: Math.max(...allLines),
        });
        return;
      }
      onCommentRange?.({ startLine: lineNum, endLine: lineNum });
    },
    [activeComposer, onCommentRange],
  );

  // --- Build rows ---
  const rows = useMemo(
    () => buildRows(file, comments, annotations, activeComposer ?? null),
    [file, comments, annotations, activeComposer],
  );

  // --- Search match counting (must be after rows) ---
  const totalSearchMatches = useMemo(() => {
    if (!searchQuery) {
      return 0;
    }
    let count = 0;
    for (const row of rows) {
      if (row.kind === "line" && row.line.type !== "hunk-header") {
        count += countMatchesInText(row.line.content, searchQuery);
      }
    }
    return count;
  }, [searchQuery, rows]);

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

  // --- Full file mode: build context lines from file content ---
  const fullFileRows = useMemo(() => {
    if (!fullFileContent) {
      return null;
    }
    const fileLines = fullFileContent.split("\n");
    // Build a set of changed line numbers (new side)
    const changedNewLines = new Set<number>();
    const addedLines = new Set<number>();
    const deletedOldLines = new Set<number>();
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === "add" && line.newLineNumber) {
          changedNewLines.add(line.newLineNumber);
          addedLines.add(line.newLineNumber);
        }
        if (line.type === "del" && line.oldLineNumber) {
          deletedOldLines.add(line.oldLineNumber);
        }
      }
    }
    return { fileLines, changedNewLines, addedLines, deletedOldLines };
  }, [fullFileContent, file.hunks]);

  if (rows.length === 0 && !fullFileRows) {
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

      {/* Full file mode */}
      {fullFileRows ? (
        <table className="w-full border-collapse font-mono text-[12.5px] leading-5">
          <colgroup>
            <col className="w-[3px]" />
            <col className="w-10" />
            <col />
          </colgroup>
          <tbody>
            {fullFileRows.fileLines.map((lineContent, i) => {
              const lineNum = i + 1;
              const isChanged = fullFileRows.addedLines.has(lineNum);
              const barColor = isChanged ? "bg-success" : "";
              const rowBg = isChanged ? "bg-diff-add-bg" : "";

              return (
                <tr
                  key={lineNum}
                  className={`group/line ${rowBg} transition-[filter] duration-75 hover:brightness-110`}
                >
                  <td className={`sticky left-0 z-[1] w-[3px] p-0 ${barColor}`} />
                  <td className="text-text-ghost border-r-border/40 bg-bg-root sticky left-[3px] z-[1] w-10 border-r p-0 pr-2 text-right text-[11px] select-none">
                    <div className="flex h-5 items-center justify-end">
                      <span className="leading-5">{lineNum}</span>
                    </div>
                  </td>
                  <td className="p-0">
                    <div className="flex h-5 items-center">
                      <span className="inline-flex w-5 shrink-0 select-none" />
                      <span
                        className="text-text-primary flex-1 overflow-x-auto pr-3 pl-1 whitespace-pre"
                        style={{ tabSize: 4 }}
                      >
                        {lineContent}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : diffMode === "split" ? (
        /* Split diff mode */
        <SplitDiffView
          rows={rows}
          highlighter={highlighter ?? null}
          language={language ?? "text"}
          shikiTheme={shikiTheme}
        />
      ) : (
        /* Unified diff mode — plain DOM (like Better Hub, one file at a time) */
        <UnifiedDiffView
          rows={rows}
          highlighter={highlighter ?? null}
          language={language ?? "text"}
          shikiTheme={shikiTheme}
          filePath={filePath}
          prNumber={prNumber}
          selectionRange={selectionRange}
          activeComposer={activeComposer ?? null}
          isDragging={isDragging}
          searchQuery={searchQuery}
          searchMatchIndex={clampedMatchIndex}
          activeSearchRef={activeSearchRef}
          onLineEnter={onLineEnter}
          onLineLeave={onLineLeave}
          onStartSelect={handleStartSelect}
          onLineHover={handleLineHover}
          onGutterClick={handleGutterClick}
          onCloseComposer={onCloseComposer}
          resolvedThreadIds={resolvedThreadIds}
          reviewCommentReactions={reviewCommentReactions}
        />
      )}

      <BlamePopover
        file={filePath}
        line={hoveredLine}
        gitRef="HEAD"
        anchorRect={anchorRect}
      />
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
}: {
  rows: FlatRow[];
  highlighter: Highlighter | null;
  language: string;
  shikiTheme: string;
}) {
  // Pair del+add lines for side-by-side display
  const splitRows = useMemo(() => {
    const result: Array<{ left: FlatLine | null; right: FlatLine | null }> = [];
    const lineRows = rows.filter((r): r is FlatRow & { kind: "line" } => r.kind === "line");

    let i = 0;
    while (i < lineRows.length) {
      const line = lineRows[i]!.line;
      if (line.type === "hunk-header") {
        result.push({ left: line, right: null });
        i++;
      } else if (line.type === "del") {
        const next = lineRows[i + 1]?.line;
        if (next?.type === "add") {
          result.push({ left: line, right: next });
          i += 2;
        } else {
          result.push({ left: line, right: null });
          i++;
        }
      } else if (line.type === "add") {
        result.push({ left: null, right: line });
        i++;
      } else {
        result.push({ left: line, right: line });
        i++;
      }
    }
    return result;
  }, [rows]);

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
        {splitRows.map((pair, i) => {
          if (pair.left?.type === "hunk-header") {
            return (
              <tr key={`split-${i}`}>
                <td
                  colSpan={5}
                  className="border-border-subtle bg-diff-hunk-bg text-info h-5 border-y px-3 text-[11px]"
                >
                  {pair.left.content}
                </td>
              </tr>
            );
          }

          return (
            <tr
              key={`split-${i}`}
              className="hover:brightness-110"
            >
              {/* Left side (old) */}
              <td
                className={`text-text-ghost border-r-border/40 border-r p-0 pr-2 text-right text-[11px] select-none ${
                  pair.left?.type === "del" ? "bg-[rgba(239,100,97,0.04)]" : "bg-bg-root"
                }`}
              >
                <span className="flex h-5 items-center justify-end leading-5">
                  {pair.left?.oldLineNumber ?? ""}
                </span>
              </td>
              <td className={`p-0 ${pair.left?.type === "del" ? "bg-diff-del-bg" : ""}`}>
                <div className="flex h-5 items-center">
                  <span
                    className={`inline-flex w-5 shrink-0 items-center justify-center text-[11px] font-semibold select-none ${
                      pair.left?.type === "del" ? "text-destructive/50" : "text-transparent"
                    }`}
                  >
                    {pair.left?.type === "del" ? "-" : " "}
                  </span>
                  <span
                    className="text-text-primary flex-1 overflow-x-auto pr-2 pl-1 whitespace-pre"
                    style={{ tabSize: 4 }}
                  >
                    {pair.left
                      ? renderLineContent(pair.left, highlighter, language, shikiTheme)
                      : ""}
                  </span>
                </div>
              </td>

              {/* Divider */}
              <td className="bg-border w-px p-0" />

              {/* Right side (new) */}
              <td
                className={`text-text-ghost border-r-border/40 border-r p-0 pr-2 text-right text-[11px] select-none ${
                  pair.right?.type === "add" ? "bg-[rgba(61,214,140,0.04)]" : "bg-bg-root"
                }`}
              >
                <span className="flex h-5 items-center justify-end leading-5">
                  {pair.right?.newLineNumber ?? ""}
                </span>
              </td>
              <td className={`p-0 ${pair.right?.type === "add" ? "bg-diff-add-bg" : ""}`}>
                <div className="flex h-5 items-center">
                  <span
                    className={`inline-flex w-5 shrink-0 items-center justify-center text-[11px] font-semibold select-none ${
                      pair.right?.type === "add" ? "text-success/50" : "text-transparent"
                    }`}
                  >
                    {pair.right?.type === "add" ? "+" : " "}
                  </span>
                  <span
                    className="text-text-primary flex-1 overflow-x-auto pr-2 pl-1 whitespace-pre"
                    style={{ tabSize: 4 }}
                  >
                    {pair.right
                      ? renderLineContent(pair.right, highlighter, language, shikiTheme)
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
  shikiTheme: string = "github-dark-default",
): React.ReactNode {
  const tokens =
    highlighter && language !== "text"
      ? safeTokenize(highlighter, line.content, language, shikiTheme)
      : null;
  if (tokens) {
    return <SyntaxContent tokens={tokens} />;
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
  filePath,
  prNumber,
  selectionRange,
  activeComposer,
  isDragging,
  searchQuery,
  searchMatchIndex,
  activeSearchRef,
  onLineEnter,
  onLineLeave,
  onStartSelect,
  onLineHover,
  onGutterClick,
  onCloseComposer,
  resolvedThreadIds,
  reviewCommentReactions,
}: {
  rows: FlatRow[];
  highlighter: Highlighter | null;
  language: string;
  shikiTheme: string;
  filePath: string;
  prNumber?: number;
  selectionRange: { start: number; end: number } | null;
  activeComposer: CommentRange | null;
  isDragging: boolean;
  searchQuery: string;
  searchMatchIndex: number;
  activeSearchRef: React.RefObject<HTMLSpanElement | null>;
  onLineEnter: (lineNumber: number, rect: { top: number; left: number }) => void;
  onLineLeave: () => void;
  onStartSelect: (lineNum: number) => void;
  onLineHover: (lineNum: number) => void;
  onGutterClick: (lineNum: number, shiftKey: boolean) => void;
  onCloseComposer?: () => void;
  resolvedThreadIds?: Set<string>;
  reviewCommentReactions?: Record<string, import("@/shared/ipc").GhReactionGroup[]>;
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
          const lineNum = row.line.newLineNumber ?? row.line.oldLineNumber;
          const isSelected =
            selectionRange !== null &&
            lineNum !== null &&
            lineNum >= selectionRange.start &&
            lineNum <= selectionRange.end;

          return (
            <DiffLineRow
              key={row.key}
              line={row.line}
              allRows={rows}
              highlighter={highlighter}
              language={language}
              shikiTheme={shikiTheme}
              onLineEnter={onLineEnter}
              onLineLeave={onLineLeave}
              onStartSelect={onStartSelect}
              onLineHover={onLineHover}
              onGutterClick={onGutterClick}
              isSelected={isSelected}
              isDragging={isDragging}
              isComposerActive={
                activeComposer !== null &&
                lineNum !== null &&
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

        if (row.kind === "comment") {
          return (
            <InlineComment
              key={row.key}
              comments={row.comments}
              prNumber={prNumber}
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

        if (row.kind === "composer" && prNumber && onCloseComposer) {
          return (
            <CommentComposer
              key={row.key}
              prNumber={prNumber}
              filePath={filePath}
              line={row.endLine}
              startLine={row.startLine !== row.endLine ? row.startLine : undefined}
              onClose={onCloseComposer}
            />
          );
        }

        return null;
      })}
    </div>
  );
}

function DiffLineRow({
  line,
  allRows,
  highlighter,
  language,
  shikiTheme,
  onLineEnter,
  onLineLeave,
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
  allRows: FlatRow[];
  highlighter: Highlighter | null;
  language: string;
  shikiTheme: string;
  onLineEnter: (lineNumber: number, rect: { top: number; left: number }) => void;
  onLineLeave: () => void;
  onStartSelect: (lineNum: number) => void;
  onLineHover: (lineNum: number) => void;
  onGutterClick: (lineNum: number, shiftKey: boolean) => void;
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
      <div className="border-border-subtle bg-diff-hunk-bg text-info flex h-5 items-center border-y px-3 text-[11px]">
        {line.content}
      </div>
    );
  }

  // Word diff pairing
  const pairRow = line.pairIndex !== null ? allRows[line.pairIndex] : null;
  const pair = pairRow?.kind === "line" ? pairRow.line : null;
  const wordDiff =
    pair &&
    ((line.type === "del" && pair.type === "add") || (line.type === "add" && pair.type === "del"))
      ? computeWordDiff(
          line.type === "del" ? line.content : pair.content,
          line.type === "add" ? line.content : pair.content,
        )
      : null;

  const hasWordDiff = !!wordDiff;
  const wordSegments = wordDiff
    ? line.type === "del"
      ? wordDiff.oldSegments
      : wordDiff.newSegments
    : null;

  const tokens =
    !hasWordDiff && highlighter && language !== "text"
      ? safeTokenize(highlighter, line.content, language, shikiTheme)
      : null;

  const lineNum = line.newLineNumber ?? line.oldLineNumber;
  const isCommentable = !!line.newLineNumber;

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
      onMouseEnter={(e) => {
        if (lineNum && isCommentable) {
          onLineHover(lineNum);
        }
        if (line.newLineNumber && line.type !== "del") {
          const rect = e.currentTarget.getBoundingClientRect();
          onLineEnter(line.newLineNumber, { top: rect.top, left: rect.left });
        }
      }}
      onMouseLeave={onLineLeave}
    >
      {/* Color bar — subtle accent inset on hover */}
      <div
        className={`sticky left-0 z-[1] w-[3px] shrink-0 ${barColor} group-hover/line:shadow-[inset_2px_0_0_rgba(212,136,58,0.15)]`}
      />
      {/* Line number gutter */}
      <div
        className={`sticky left-[3px] z-[1] w-10 shrink-0 border-r pr-2 text-right text-[11px] select-none ${
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
          {isCommentable && !isComposerActive && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                if (lineNum) {
                  onStartSelect(lineNum);
                }
              }}
              onClick={(e) => {
                if (lineNum) {
                  onGutterClick(lineNum, e.shiftKey);
                }
              }}
              className="bg-primary text-bg-root absolute top-1/2 left-0.5 flex h-4 w-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm opacity-0 shadow-sm transition-opacity group-hover/line:opacity-100 hover:scale-110"
              tabIndex={-1}
              aria-label={`Comment on line ${lineNum}`}
            >
              <Plus
                size={12}
                strokeWidth={2.5}
              />
            </button>
          )}
          <span className="leading-5">
            {line.type !== "del" ? line.newLineNumber : line.oldLineNumber}
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
            <WordDiffContent
              segments={wordSegments}
              type={line.type}
            />
          ) : searchQuery ? (
            <SearchHighlightedContent
              text={line.content}
              tokens={tokens}
              query={searchQuery}
              matchOffset={searchMatchOffset}
              activeIndex={activeSearchIndex}
              activeRef={activeSearchRef}
            />
          ) : tokens ? (
            <SyntaxContent tokens={tokens} />
          ) : (
            line.content
          )}
        </span>
      </div>
    </div>
  );
}

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
}: {
  text: string;
  tokens: ShikiToken[] | null;
  query: string;
  matchOffset: number;
  activeIndex: number;
  activeRef: React.RefObject<HTMLSpanElement | null>;
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
                  style={{ color: token.color }}
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
                style={{ color: token.color }}
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

interface ShikiToken {
  content: string;
  color?: string;
}

function safeTokenize(
  highlighter: Highlighter,
  content: string,
  lang: string,
  shikiTheme: string = "github-dark-default",
): ShikiToken[] | null {
  try {
    const loadedLangs = highlighter.getLoadedLanguages();
    if (!loadedLangs.includes(lang)) {
      return null;
    }
    const result = highlighter.codeToTokens(content, {
      lang: lang as Parameters<Highlighter["codeToTokens"]>[1]["lang"],
      theme: shikiTheme,
    } as Parameters<Highlighter["codeToTokens"]>[1]);
    return result.tokens[0] ?? null;
  } catch {
    return null;
  }
}

function SyntaxContent({ tokens }: { tokens: ShikiToken[] }) {
  return (
    <>
      {tokens.map((token, i) => (
        <span
          key={`${i}-${token.content.slice(0, 5)}`}
          style={{ color: token.color }}
        >
          {token.content}
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
