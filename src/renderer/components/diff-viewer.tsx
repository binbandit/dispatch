import type { DiffFile, DiffLine, Segment } from "../lib/diff-parser";
import type { Annotation } from "./ci-annotation";
import type { ReviewComment } from "./inline-comment";
import type { Highlighter } from "shiki";

import { Plus } from "lucide-react";
import { useMemo, useRef } from "react";

import { computeWordDiff } from "../lib/diff-parser";
import { BlamePopover, useBlameHover } from "./blame-popover";
import { CiAnnotation } from "./ci-annotation";
import { CommentComposer } from "./comment-composer";
import { InlineComment } from "./inline-comment";

/**
 * Table-based diff viewer — inspired by Better Hub's column layout.
 *
 * Columns:
 *  1. Color bar (3px) — green/red indicator, sticky left
 *  2. Line number (40px) — contains the absolute-positioned "+" button, sticky
 *  3. Code content (flex) — marker + syntax-highlighted code
 *
 * Comment composer, inline comments, and CI annotations render as full-width
 * <tr> rows with colSpan={3}, naturally aligned by the table.
 */

interface DiffViewerProps {
  file: DiffFile;
  highlighter?: Highlighter | null;
  language?: string;
  comments?: Map<string, ReviewComment[]>;
  annotations?: Map<string, Annotation[]>;
  prNumber?: number;
  activeComposer?: { line: number } | null;
  onGutterClick?: (line: number) => void;
  onCloseComposer?: () => void;
}

// ---------------------------------------------------------------------------
// Flat row model
// ---------------------------------------------------------------------------

type FlatLine = DiffLine & { pairIndex: number | null };

type FlatRow =
  | { kind: "line"; key: string; line: FlatLine }
  | { kind: "comment"; key: string; comments: ReviewComment[] }
  | { kind: "annotation"; key: string; annotations: Annotation[] }
  | { kind: "composer"; key: string; line: number };

function buildRows(
  file: DiffFile,
  comments: Map<string, ReviewComment[]>,
  annotations: Map<string, Annotation[]>,
  composerLine: number | null,
): FlatRow[] {
  const rows: FlatRow[] = [];
  const filePath = file.newPath || file.oldPath;

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

      if (composerLine && lineNum === composerLine) {
        rows.push({ kind: "composer", key: `composer-${composerLine}`, line: composerLine });
      }
    }
    hunkIndex++;
  }

  return rows;
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
  onGutterClick,
  onCloseComposer,
}: DiffViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { hoveredLine, anchorRect, onLineEnter, onLineLeave } = useBlameHover();

  const rows = useMemo(
    () => buildRows(file, comments, annotations, activeComposer?.line ?? null),
    [file, comments, annotations, activeComposer],
  );

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-text-tertiary text-xs">No changes in this file</p>
      </div>
    );
  }

  const filePath = file.newPath || file.oldPath;

  return (
    <div
      ref={scrollRef}
      className="bg-bg-root flex-1 overflow-auto"
    >
      <table className="w-full border-collapse font-mono text-[12.5px] leading-5">
        <colgroup>
          <col className="w-[3px]" />
          <col className="w-10" />
          <col />
        </colgroup>
        <tbody>
          {rows.map((row) => {
            if (row.kind === "line") {
              return (
                <DiffLineRow
                  key={row.key}
                  line={row.line}
                  allRows={rows}
                  highlighter={highlighter ?? null}
                  language={language ?? "text"}
                  onLineEnter={onLineEnter}
                  onLineLeave={onLineLeave}
                  onGutterClick={onGutterClick}
                  isComposerActive={
                    activeComposer?.line === (row.line.newLineNumber ?? row.line.oldLineNumber)
                  }
                />
              );
            }

            if (row.kind === "comment") {
              return (
                <tr key={row.key}>
                  <td
                    colSpan={3}
                    className="p-0"
                  >
                    <InlineComment comments={row.comments} />
                  </td>
                </tr>
              );
            }

            if (row.kind === "annotation") {
              return (
                <tr key={row.key}>
                  <td
                    colSpan={3}
                    className="p-0"
                  >
                    <CiAnnotation annotations={row.annotations} />
                  </td>
                </tr>
              );
            }

            if (row.kind === "composer" && prNumber && onCloseComposer) {
              return (
                <tr key={row.key}>
                  <td
                    colSpan={3}
                    className="p-0"
                  >
                    <CommentComposer
                      prNumber={prNumber}
                      filePath={filePath}
                      line={row.line}
                      onClose={onCloseComposer}
                    />
                  </td>
                </tr>
              );
            }

            return null;
          })}
        </tbody>
      </table>

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
// DiffLineRow — a single <tr> in the diff table
// ---------------------------------------------------------------------------

function DiffLineRow({
  line,
  allRows,
  highlighter,
  language,
  onLineEnter,
  onLineLeave,
  onGutterClick,
  isComposerActive,
}: {
  line: FlatLine;
  allRows: FlatRow[];
  highlighter: Highlighter | null;
  language: string;
  onLineEnter: (lineNumber: number, rect: { top: number; left: number }) => void;
  onLineLeave: () => void;
  onGutterClick?: (line: number) => void;
  isComposerActive?: boolean;
}) {
  // Hunk headers span the full row
  if (line.type === "hunk-header") {
    return (
      <tr>
        <td
          colSpan={3}
          className="border-border-subtle bg-diff-hunk-bg text-info sticky top-0 z-[1] h-5 border-y px-3 text-[11px]"
        >
          {line.content}
        </td>
      </tr>
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

  // Syntax highlighting (skip if word diff is active)
  const tokens =
    !hasWordDiff && highlighter && language !== "text"
      ? safeTokenize(highlighter, line.content, language)
      : null;

  const lineNum = line.newLineNumber ?? line.oldLineNumber;
  const isCommentable = !!line.newLineNumber;

  // Row background
  const rowBg =
    line.type === "add" ? "bg-diff-add-bg" : line.type === "del" ? "bg-diff-del-bg" : "";

  // Color bar on left edge
  const barColor = line.type === "add" ? "bg-success" : line.type === "del" ? "bg-destructive" : "";

  return (
    <tr
      className={`group/line ${rowBg} transition-[filter] duration-75 hover:brightness-110`}
      onMouseEnter={(e) => {
        if (line.newLineNumber && line.type !== "del") {
          const rect = e.currentTarget.getBoundingClientRect();
          onLineEnter(line.newLineNumber, { top: rect.top, left: rect.left });
        }
      }}
      onMouseLeave={onLineLeave}
    >
      {/* Column 1: Color bar */}
      <td className={`sticky left-0 z-[1] w-[3px] p-0 ${barColor}`} />

      {/* Column 2: Line number + add-comment button */}
      <td
        className={`text-text-ghost sticky left-[3px] z-[1] w-10 border-r p-0 pr-2 text-right text-[11px] select-none ${
          line.type === "add"
            ? "border-r-success/10 bg-[rgba(61,214,140,0.04)]"
            : line.type === "del"
              ? "border-r-destructive/10 bg-[rgba(239,100,97,0.04)]"
              : "border-r-border/40 bg-bg-root"
        }`}
      >
        <div className="relative flex h-5 items-center justify-end">
          {/* The "+" button — hidden by default, shown on row hover via group */}
          {isCommentable && !isComposerActive && (
            <button
              type="button"
              onClick={() => lineNum && onGutterClick?.(lineNum)}
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
          {/* Line number text */}
          <span className="leading-5">
            {line.type !== "del" ? line.newLineNumber : line.oldLineNumber}
          </span>
        </div>
      </td>

      {/* Column 3: Marker + code content */}
      <td className="p-0">
        <div className="flex h-5 items-center">
          {/* +/- marker */}
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
          {/* Code */}
          <span
            className="text-text-primary flex-1 overflow-x-auto pr-3 pl-1 whitespace-pre"
            style={{ tabSize: 4 }}
          >
            {wordSegments ? (
              <WordDiffContent
                segments={wordSegments}
                type={line.type}
              />
            ) : tokens ? (
              <SyntaxContent tokens={tokens} />
            ) : (
              line.content
            )}
          </span>
        </div>
      </td>
    </tr>
  );
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
): ShikiToken[] | null {
  try {
    const loadedLangs = highlighter.getLoadedLanguages();
    if (!loadedLangs.includes(lang)) {
      return null;
    }
    const result = highlighter.codeToTokens(content, {
      lang: lang as Parameters<Highlighter["codeToTokens"]>[1]["lang"],
      theme: "github-dark-default",
    });
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
