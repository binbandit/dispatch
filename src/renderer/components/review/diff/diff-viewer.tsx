import type { AiSuggestion } from "@/renderer/lib/review/ai-suggestions";
import type { ReviewThreadState } from "@/renderer/lib/review/review-comments";
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
import {
  buildFullFileRows,
  buildRows,
  buildSplitRows,
  getCommentTarget,
  type CommentRange,
  type CommentSide,
  type CommentTarget,
  type FlatLine,
  type FlatRow,
  type NonLineFlatRow,
} from "@/renderer/components/review/diff/diff-row-builder";
import { SemanticDiffSummary } from "@/renderer/components/review/diff/semantic-diff-summary";
import { SymbolPeekPopover } from "@/renderer/components/review/diff/symbol-peek-popover";
import { useTheme } from "@/renderer/lib/app/theme-context";
import { handleSearchInputEscape } from "@/renderer/lib/keyboard/search-input";
import { getSuggestionTextForRange } from "@/renderer/lib/review/comment-suggestions";
import { getDiffFilePath, type DiffFile, type Segment } from "@/renderer/lib/review/diff-parser";
import {
  DEFAULT_CODE_THEME_DARK,
  DEFAULT_CODE_THEME_LIGHT,
  ensureHighlighterResources,
  getShikiTokenColor,
  isLanguageLoaded,
  normalizeLanguage,
  type ShikiToken,
  type ThemeMode,
} from "@/renderer/lib/review/highlighter";
import { REVIEW_DIFF_SEARCH_EVENT } from "@/renderer/lib/review/review-focus-targets";
import { analyzeSemanticDiff } from "@/renderer/lib/review/semantic-diff";
import { ChevronDown, ChevronUp, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Table-based diff viewer with:
 * - Cmd+F search with match highlighting + navigation
 * - Multi-line drag-to-select for comments
 * - Full-file mode (shows entire file with changes highlighted)
 * - Split/side-by-side diff mode
 */

export type { CommentRange, CommentSide } from "@/renderer/components/review/diff/diff-row-builder";

export type DiffMode = "unified" | "split" | "full-file";

interface DiffViewerProps {
  file: DiffFile;
  oldLineBlameRef?: string | null;
  newLineBlameRef?: string;
  highlighter?: Highlighter | null;
  language?: string;
  comments?: Map<string, ReviewComment[]>;
  annotations?: Map<string, Annotation[]>;
  prNumber?: number;
  currentUserLogin?: string | null;
  activeComposer?: CommentRange | null;
  onCommentRange?: (range: CommentRange) => void;
  onCloseComposer?: () => void;
  /** Full file content for "show full file" mode */
  fullFileContent?: string | null;
  diffMode?: DiffMode;
  /** Thread metadata keyed by root review comment databaseId */
  reviewThreadStateByRootCommentId?: Map<number, ReviewThreadState>;
  /** Reaction data for review comments, keyed by databaseId (as string) */
  reviewCommentReactions?: Record<string, GhReactionGroup[]>;
  /** AI-generated suggestions, keyed by "path:line" */
  aiSuggestions?: Map<string, AiSuggestion[]>;
  reviewActionsEnabled?: boolean;
  bottomOverlayInset?: number;
  onPostSuggestion?: (suggestion: AiSuggestion, body?: string) => Promise<void>;
  onDismissSuggestion?: (id: string) => void;
  /** When set, scroll to the comment at this line number and highlight it */
  scrollToLine?: number | null;
  onScrollToLineComplete?: () => void;
  /** Experimental: show a semantic-diff summary banner when patterns fire */
  semanticDiffEnabled?: boolean;
  /** Experimental: ⌘-click an identifier to peek its call sites */
  symbolPeekEnabled?: boolean;
}

const DEFAULT_SHIKI_THEME_PAIR = {
  light: DEFAULT_CODE_THEME_LIGHT,
  dark: DEFAULT_CODE_THEME_DARK,
} as const;

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------

const SYMBOL_IDENTIFIER_CHAR_PATTERN = /[\p{L}\p{N}_$]/u;
const SYMBOL_IDENTIFIER_START_PATTERN = /^[\p{L}_$]/u;
const SYMBOL_MAX_LENGTH = 80;

function extractSymbolAtPoint(clientX: number, clientY: number): string | null {
  const range = createCaretRange(clientX, clientY);
  if (!range) {
    return null;
  }
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) {
    return null;
  }
  const text = node.nodeValue ?? "";
  if (text.length === 0) {
    return null;
  }

  let offset = range.startOffset;
  if (offset >= text.length) {
    offset = text.length - 1;
  }
  if (offset < 0) {
    return null;
  }

  const characterAtOffset = text[offset] ?? "";
  const previousCharacter = text[offset - 1] ?? "";
  const cursorOnIdentifier = SYMBOL_IDENTIFIER_CHAR_PATTERN.test(characterAtOffset);
  const cursorAtIdentifierEdge = SYMBOL_IDENTIFIER_CHAR_PATTERN.test(previousCharacter);
  if (!cursorOnIdentifier && !cursorAtIdentifierEdge) {
    return null;
  }

  let start = cursorOnIdentifier ? offset : offset - 1;
  let end = cursorOnIdentifier ? offset : offset - 1;
  while (start > 0 && SYMBOL_IDENTIFIER_CHAR_PATTERN.test(text[start - 1] ?? "")) {
    start--;
  }
  while (end < text.length && SYMBOL_IDENTIFIER_CHAR_PATTERN.test(text[end] ?? "")) {
    end++;
  }
  const symbol = text.slice(start, end);
  if (symbol.length === 0 || symbol.length > SYMBOL_MAX_LENGTH) {
    return null;
  }
  if (!SYMBOL_IDENTIFIER_START_PATTERN.test(symbol)) {
    return null;
  }
  return symbol;
}

function createCaretRange(clientX: number, clientY: number): Range | null {
  const caretDocument = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof caretDocument.caretRangeFromPoint === "function") {
    return caretDocument.caretRangeFromPoint(clientX, clientY);
  }
  if (typeof caretDocument.caretPositionFromPoint === "function") {
    const position = caretDocument.caretPositionFromPoint(clientX, clientY);
    if (!position) {
      return null;
    }
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }
  return null;
}

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

function UnsupportedDiffState({ file }: { file: DiffFile }) {
  const hasStats = file.additions > 0 || file.deletions > 0;
  const title =
    file.contentKind === "binary" ? "Binary diff not available" : "Line-level diff unavailable";
  const description =
    file.contentKind === "binary"
      ? "Dispatch found this changed file, but binary formats like parquet cannot be rendered line by line."
      : "Dispatch found this changed file, but GitHub did not provide a line-level patch for it.";

  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="border-border-subtle bg-bg-surface/70 max-w-md rounded-md border px-4 py-3 text-center shadow-sm">
        <p className="text-text-primary text-sm font-medium">{title}</p>
        <p className="text-text-tertiary mt-1 text-xs leading-5">{description}</p>
        {hasStats && (
          <div className="mt-3 flex items-center justify-center gap-3 font-mono text-[11px]">
            {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
            {file.deletions > 0 && <span className="text-destructive">-{file.deletions}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiffViewer
// ---------------------------------------------------------------------------

export function DiffViewer({
  file,
  oldLineBlameRef = null,
  newLineBlameRef = "HEAD",
  highlighter,
  language,
  comments = new Map(),
  annotations = new Map(),
  prNumber,
  currentUserLogin,
  activeComposer,
  onCommentRange,
  onCloseComposer,
  fullFileContent,
  diffMode = "unified",
  reviewThreadStateByRootCommentId,
  reviewCommentReactions,
  aiSuggestions,
  reviewActionsEnabled = true,
  bottomOverlayInset = 0,
  onPostSuggestion,
  onDismissSuggestion,
  scrollToLine,
  onScrollToLineComplete,
  semanticDiffEnabled = false,
  symbolPeekEnabled = false,
}: DiffViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { codeThemeDark, codeThemeLight, resolvedTheme } = useTheme();
  const shikiTheme = useMemo(
    () => ({ light: codeThemeLight, dark: codeThemeDark }),
    [codeThemeDark, codeThemeLight],
  );
  const [, setSyntaxResourceVersion] = useState(0);

  useEffect(() => {
    if (!highlighter) {
      return;
    }

    let cancelled = false;
    void ensureHighlighterResources({
      languages: language && language !== "text" ? [language] : [],
      themes: [shikiTheme.dark, shikiTheme.light],
    }).then((loadedResources) => {
      if (!cancelled && loadedResources) {
        setSyntaxResourceVersion((version) => version + 1);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [highlighter, language, shikiTheme.dark, shikiTheme.light]);

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

  // --- Scroll to a specific comment line (triggered by thread clicks) ---
  useEffect(() => {
    if (scrollToLine === null || scrollToLine === undefined || !scrollRef.current) {
      return;
    }
    // Wait for the DOM to render comment rows after file switch
    const raf = requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(`[data-comment-line="${scrollToLine}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        // Brief highlight pulse
        el.classList.add("scroll-target-highlight");
        setTimeout(() => el.classList.remove("scroll-target-highlight"), 1500);
      }
      onScrollToLineComplete?.();
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollToLine, onScrollToLineComplete]);

  // --- Search state ---
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeSearchRef = useRef<HTMLSpanElement>(null);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  // --- Drag-to-select state ---
  const selectingFromRef = useRef<CommentTarget | null>(null);
  const hoverLineRef = useRef<CommentTarget | null>(null);
  const [dragState, setDragState] = useState<{
    from: CommentTarget | null;
    hover: CommentTarget | null;
  }>({ from: null, hover: null });

  const selectionRange = useMemo<{ side: CommentSide; start: number; end: number } | null>(() => {
    if (
      dragState.from !== null &&
      dragState.hover !== null &&
      dragState.from.side === dragState.hover.side
    ) {
      return {
        side: dragState.from.side,
        start: Math.min(dragState.from.line, dragState.hover.line),
        end: Math.max(dragState.from.line, dragState.hover.line),
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
  }, [dragState, activeComposer]);

  // Global mouseUp to commit selection
  useEffect(() => {
    function handleMouseUp() {
      if (selectingFromRef.current !== null) {
        const from = selectingFromRef.current;
        const to = hoverLineRef.current ?? from;
        selectingFromRef.current = null;
        hoverLineRef.current = null;
        setDragState({ from: null, hover: null });
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
    setDragState({ from: target, hover: target });
  }, []);

  const handleLineHover = useCallback((target: CommentTarget) => {
    if (selectingFromRef.current !== null && selectingFromRef.current.side === target.side) {
      hoverLineRef.current = target;
      setDragState((prev) => ({ ...prev, hover: target }));
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

  // --- Semantic diff summary (experimental) ---
  const semanticSignals = useMemo(
    () => (semanticDiffEnabled ? analyzeSemanticDiff(file) : []),
    [semanticDiffEnabled, file],
  );

  // --- Symbol peek (experimental) ---
  const [symbolPeek, setSymbolPeek] = useState<{
    symbol: string;
    anchor: { x: number; y: number };
  } | null>(null);
  const [commandHeld, setCommandHeld] = useState(false);

  useEffect(() => {
    if (!symbolPeekEnabled) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Meta" || event.key === "Control") {
        setCommandHeld(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Meta" || event.key === "Control") {
        setCommandHeld(false);
      }
    };
    const handleBlur = () => setCommandHeld(false);
    globalThis.addEventListener("keydown", handleKeyDown);
    globalThis.addEventListener("keyup", handleKeyUp);
    globalThis.addEventListener("blur", handleBlur);
    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
      globalThis.removeEventListener("keyup", handleKeyUp);
      globalThis.removeEventListener("blur", handleBlur);
    };
  }, [symbolPeekEnabled]);

  const handleDiffClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!symbolPeekEnabled || !(event.metaKey || event.ctrlKey)) {
        return;
      }
      const target = event.target as HTMLElement;
      if (target.closest("[data-review-comment-trigger], button, a, input, textarea")) {
        return;
      }
      const symbol = extractSymbolAtPoint(event.clientX, event.clientY);
      if (!symbol) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setSymbolPeek({ symbol, anchor: { x: event.clientX, y: event.clientY } });
    },
    [symbolPeekEnabled],
  );

  // --- Build rows ---
  const rows = useMemo(
    () =>
      buildRows({
        file,
        comments,
        annotations,
        composerRange: activeComposer ?? null,
        aiSuggestions,
      }),
    [file, comments, annotations, activeComposer, aiSuggestions],
  );

  const fullFileModeRows = useMemo(
    () =>
      buildFullFileRows({
        file,
        fullFileContent,
        comments,
        annotations,
        composerRange: activeComposer ?? null,
        aiSuggestions,
      }),
    [file, fullFileContent, comments, annotations, activeComposer, aiSuggestions],
  );

  const activeRows =
    diffMode === "full-file" && fullFileModeRows !== null ? fullFileModeRows : rows;
  const commentingEnabled = reviewActionsEnabled && Boolean(onCommentRange);
  const composerSuggestionText = useMemo(
    () => getSuggestionTextForRange(activeRows, activeComposer ?? null),
    [activeComposer, activeRows],
  );

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
        openSearch();
      }
    }
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
    };
  }, [openSearch]);

  useEffect(() => {
    const handleReviewSearch = () => openSearch();
    globalThis.addEventListener(REVIEW_DIFF_SEARCH_EVENT, handleReviewSearch);
    return () => {
      globalThis.removeEventListener(REVIEW_DIFF_SEARCH_EVENT, handleReviewSearch);
    };
  }, [openSearch]);

  if (activeRows.length === 0) {
    if (file.contentKind === "binary" || file.contentKind === "metadata-only") {
      return <UnsupportedDiffState file={file} />;
    }

    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-text-tertiary text-xs">No changes in this file</p>
      </div>
    );
  }

  const filePath = getDiffFilePath(file);
  const isDragging = dragState.from !== null;

  const symbolPeekActive = symbolPeekEnabled && commandHeld;

  return (
    <div
      ref={scrollRef}
      data-review-focus-target="diff-viewer"
      data-symbol-peek-armed={symbolPeekActive ? "true" : undefined}
      onClick={handleDiffClick}
      className={`focus:ring-border-accent/70 bg-bg-root relative flex-1 overflow-auto rounded-sm focus:ring-1 focus:outline-none focus:ring-inset ${
        isDragging ? "select-none" : ""
      }`}
      style={{
        paddingBottom: bottomOverlayInset,
        scrollPaddingBottom: bottomOverlayInset,
      }}
      tabIndex={-1}
    >
      {semanticDiffEnabled && semanticSignals.length > 0 && (
        <SemanticDiffSummary signals={semanticSignals} />
      )}
      {symbolPeekActive && !symbolPeek && (
        <div
          aria-hidden
          className="border-border-accent bg-accent-muted/80 text-accent-text pointer-events-none fixed right-4 bottom-4 z-30 flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-wide backdrop-blur-sm"
          style={{ boxShadow: "var(--shadow-md)" }}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
          click an identifier to peek
        </div>
      )}
      {symbolPeek && (
        <SymbolPeekPopover
          symbol={symbolPeek.symbol}
          anchor={symbolPeek.anchor}
          currentFile={filePath}
          onClose={() => setSymbolPeek(null)}
        />
      )}
      {/* Search bar — floating overlay top-right */}
      {searchOpen && (
        <div className="border-border bg-bg-elevated sticky top-0 right-0 z-10 ml-auto flex w-80 max-w-full items-center gap-1.5 rounded-bl-md border-b border-l px-3 py-1.5 shadow-lg">
          <Search
            size={13}
            className="text-text-tertiary shrink-0"
          />
          <input
            ref={searchInputRef}
            data-review-focus-target="diff-search"
            aria-label="Find in diff"
            autoComplete="off"
            name="diff-search"
            spellCheck={false}
            type="search"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchMatchIndex(0);
            }}
            placeholder="Find in diff…"
            className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-xs focus:outline-none"
            onKeyDown={(e) => {
              if (
                handleSearchInputEscape(e, {
                  onEscape: () => {
                    setSearchOpen(false);
                    setSearchQuery("");
                  },
                })
              ) {
                return;
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
          currentUserLogin={currentUserLogin}
          reviewActionsEnabled={reviewActionsEnabled}
          reviewThreadStateByRootCommentId={reviewThreadStateByRootCommentId}
          reviewCommentReactions={reviewCommentReactions}
          onPostSuggestion={onPostSuggestion}
          onDismissSuggestion={onDismissSuggestion}
          onCloseComposer={onCloseComposer}
        />
      ) : (
        /* Unified diff mode — plain DOM (like Better Hub, one file at a time) */
        <UnifiedDiffView
          rows={activeRows}
          oldLineBlameRef={oldLineBlameRef}
          newLineBlameRef={newLineBlameRef}
          highlighter={highlighter ?? null}
          language={language ?? "text"}
          shikiTheme={shikiTheme}
          resolvedTheme={resolvedTheme}
          filePath={filePath}
          prNumber={prNumber}
          currentUserLogin={currentUserLogin}
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
          reviewThreadStateByRootCommentId={reviewThreadStateByRootCommentId}
          reviewCommentReactions={reviewCommentReactions}
          onPostSuggestion={onPostSuggestion}
          onDismissSuggestion={onDismissSuggestion}
          composerSuggestionText={composerSuggestionText}
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
  currentUserLogin,
  reviewActionsEnabled,
  reviewThreadStateByRootCommentId,
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
  currentUserLogin?: string | null;
  reviewActionsEnabled: boolean;
  reviewThreadStateByRootCommentId?: Map<number, ReviewThreadState>;
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
              currentUserLogin,
              reviewActionsEnabled,
              reviewThreadStateByRootCommentId,
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
                  className="border-border-subtle bg-diff-hunk-bg text-info h-6 border-y px-3 text-[11px] focus:outline-none"
                  data-hunk
                  tabIndex={-1}
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
                  row.left?.type === "del" ? "bg-diff-del-bg" : "bg-bg-root"
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
                  row.right?.type === "add" ? "bg-diff-add-bg" : "bg-bg-root"
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
  oldLineBlameRef,
  newLineBlameRef,
  highlighter,
  language,
  shikiTheme,
  resolvedTheme,
  filePath,
  prNumber,
  currentUserLogin,
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
  reviewThreadStateByRootCommentId,
  reviewCommentReactions,
  onPostSuggestion,
  onDismissSuggestion,
  composerSuggestionText,
}: {
  rows: FlatRow[];
  oldLineBlameRef: string | null;
  newLineBlameRef: string;
  highlighter: Highlighter | null;
  language: string;
  shikiTheme: { light: string; dark: string };
  resolvedTheme: ThemeMode;
  filePath: string;
  prNumber?: number;
  currentUserLogin?: string | null;
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
  reviewThreadStateByRootCommentId?: Map<number, ReviewThreadState>;
  reviewCommentReactions?: Record<string, GhReactionGroup[]>;
  onPostSuggestion?: (suggestion: AiSuggestion, body?: string) => Promise<void>;
  onDismissSuggestion?: (id: string) => void;
  composerSuggestionText?: string | null;
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
              oldLineBlameRef={oldLineBlameRef}
              newLineBlameRef={newLineBlameRef}
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
          currentUserLogin,
          reviewActionsEnabled,
          reviewThreadStateByRootCommentId,
          reviewCommentReactions,
          onPostSuggestion,
          onDismissSuggestion,
          onCloseComposer,
          composerSuggestionText,
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
  currentUserLogin,
  reviewThreadStateByRootCommentId,
  reviewCommentReactions,
  onPostSuggestion,
  onDismissSuggestion,
  onCloseComposer,
  composerSuggestionText,
}: {
  row: NonLineFlatRow;
  prNumber?: number;
  filePath: string;
  reviewActionsEnabled: boolean;
  currentUserLogin?: string | null;
  reviewThreadStateByRootCommentId?: Map<number, ReviewThreadState>;
  reviewCommentReactions?: Record<string, GhReactionGroup[]>;
  onPostSuggestion?: (suggestion: AiSuggestion, body?: string) => Promise<void>;
  onDismissSuggestion?: (id: string) => void;
  onCloseComposer?: () => void;
  composerSuggestionText?: string | null;
}) {
  if (row.kind === "comment") {
    const commentLine = row.comments[0]?.line ?? row.comments[0]?.original_line;
    return (
      <div
        key={row.key}
        data-comment-line={commentLine ?? undefined}
        data-comment
        tabIndex={-1}
        className="focus:ring-border-accent/70 rounded-md focus:ring-1 focus:outline-none focus:ring-inset"
      >
        <InlineComment
          comments={row.comments}
          prNumber={prNumber}
          currentUserLogin={currentUserLogin}
          reviewActionsEnabled={reviewActionsEnabled}
          reviewThreadStateByRootCommentId={reviewThreadStateByRootCommentId}
          reviewCommentReactions={reviewCommentReactions}
        />
      </div>
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
        suggestionText={composerSuggestionText ?? undefined}
        onClose={onCloseComposer}
      />
    );
  }

  return null;
}

function DiffLineRow({
  line,
  oldLineBlameRef,
  newLineBlameRef,
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
  oldLineBlameRef: string | null;
  newLineBlameRef: string;
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
      <div
        className="border-border-subtle bg-diff-hunk-bg text-info flex h-6 items-center border-y px-3 text-[11px] focus:outline-none"
        data-hunk
        tabIndex={-1}
      >
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
  const blameLine = line.type === "del" ? line.oldLineNumber : line.newLineNumber;
  const blameRef = line.type === "del" ? oldLineBlameRef : newLineBlameRef;
  const showBlameButton = blameLine !== null && blameRef !== null;
  const showLineActions = showBlameButton || (canCommentOnLine && !isComposerActive);

  const rowBg = isSelected
    ? "!bg-[rgba(155,149,144,0.12)]"
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
            ? "border-r-text-secondary/25 text-text-secondary bg-[rgba(155,149,144,0.08)]"
            : line.type === "add"
              ? "border-r-success/20 text-text-tertiary bg-diff-add-bg"
              : line.type === "del"
                ? "border-r-destructive/20 text-text-tertiary bg-diff-del-bg"
                : "border-r-border/40 bg-bg-root text-text-ghost"
        }`}
      >
        <div className="relative flex h-5 items-center justify-end">
          {showLineActions && (
            <div className="pointer-events-none absolute top-1/2 left-1 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-focus-within/line:pointer-events-auto group-focus-within/line:opacity-100 group-hover/line:pointer-events-auto group-hover/line:opacity-100">
              {canCommentOnLine && !isComposerActive && (
                <button
                  type="button"
                  data-review-comment-trigger="true"
                  data-review-comment-line={commentTarget.line}
                  data-review-comment-side={commentTarget.side}
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
                  gitRef={blameRef}
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
  const normalizedLanguage = normalizeLanguage(lang);
  const cacheKey = getShikiTokenCacheKey(content, normalizedLanguage, themePair);
  const cached = shikiTokenCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    if (!isLanguageLoaded(highlighter, normalizedLanguage)) {
      setShikiTokenCache(cacheKey, null);
      return null;
    }
    const result = (() => {
      try {
        return highlighter.codeToTokens(content, {
          lang: normalizedLanguage as Parameters<Highlighter["codeToTokens"]>[1]["lang"],
          themes: {
            light: themePair.light,
            dark: themePair.dark,
          },
        } as unknown as Parameters<Highlighter["codeToTokens"]>[1]);
      } catch {
        return highlighter.codeToTokens(content, {
          lang: normalizedLanguage as Parameters<Highlighter["codeToTokens"]>[1]["lang"],
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
