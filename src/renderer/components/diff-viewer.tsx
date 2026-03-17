import type { DiffFile, DiffLine } from "../lib/diff-parser";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useMemo } from "react";

import { computeWordDiff } from "../lib/diff-parser";

/**
 * Virtualized diff viewer — DISPATCH-DESIGN-SYSTEM.md § 8.6
 *
 * Renders a parsed DiffFile with virtualized scrolling.
 * Supports 50,000+ lines at 60fps.
 */

interface DiffViewerProps {
  file: DiffFile;
}

type FlatLine = DiffLine & {
  /** Index of the next line (used for word-diff pairing) */
  pairIndex: number | null;
};

/**
 * Flatten all hunks into a single line array for the virtualizer.
 */
function flattenLines(file: DiffFile): FlatLine[] {
  const flat: FlatLine[] = [];

  for (const hunk of file.hunks) {
    // Add hunk header as a line
    flat.push({
      type: "hunk-header",
      content: hunk.header,
      oldLineNumber: null,
      newLineNumber: null,
      pairIndex: null,
    });

    // Add lines, detecting del+add pairs for word diff
    for (let i = 0; i < hunk.lines.length; i++) {
      const line = hunk.lines[i]!;
      const next = hunk.lines[i + 1];

      let pairIndex: number | null = null;
      if (line.type === "del" && next?.type === "add") {
        pairIndex = flat.length + 1; // the next flat line
      } else if (line.type === "add" && i > 0 && hunk.lines[i - 1]?.type === "del") {
        pairIndex = flat.length - 1; // the previous flat line
      }

      flat.push({ ...line, pairIndex });
    }
  }

  return flat;
}

const ROW_HEIGHT = 20; // Design system: line-height 20px

export function DiffViewer({ file }: DiffViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const flatLines = useMemo(() => flattenLines(file), [file]);

  const virtualizer = useVirtualizer({
    count: flatLines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  if (flatLines.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-text-tertiary text-xs">No changes in this file</p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="bg-bg-root flex-1 overflow-auto"
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: "relative",
          width: "100%",
        }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const line = flatLines[item.index]!;

          return (
            <div
              key={item.index}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: ROW_HEIGHT,
                transform: `translateY(${item.start}px)`,
              }}
            >
              <DiffRow
                line={line}
                flatLines={flatLines}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row renderer
// ---------------------------------------------------------------------------

function DiffRow({ line, flatLines }: { line: FlatLine; flatLines: FlatLine[] }) {
  if (line.type === "hunk-header") {
    return <HunkHeaderRow content={line.content} />;
  }

  // Word diff pairing
  const pair = line.pairIndex !== null ? flatLines[line.pairIndex] : null;
  const wordDiff =
    pair &&
    ((line.type === "del" && pair.type === "add") || (line.type === "add" && pair.type === "del"))
      ? computeWordDiff(
          line.type === "del" ? line.content : pair.content,
          line.type === "add" ? line.content : pair.content,
        )
      : null;

  const segments = wordDiff
    ? line.type === "del"
      ? wordDiff.oldSegments
      : wordDiff.newSegments
    : null;

  return (
    <div
      className={`flex h-5 items-center text-[12.5px] leading-5 ${
        line.type === "add" ? "bg-diff-add-bg" : line.type === "del" ? "bg-diff-del-bg" : ""
      }`}
      style={{ tabSize: 4 }}
    >
      {/* Gutter: old line number (22px) */}
      <span className="text-text-ghost inline-flex h-full w-[26px] shrink-0 items-center justify-end pr-1 font-mono text-[11px] select-none">
        {line.type !== "add" ? line.oldLineNumber : ""}
      </span>

      {/* Gutter: new line number (22px) */}
      <span className="text-text-ghost inline-flex h-full w-[26px] shrink-0 items-center justify-end pr-1 font-mono text-[11px] select-none">
        {line.type !== "del" ? line.newLineNumber : ""}
      </span>

      {/* Marker column (16px) */}
      <span
        className={`inline-flex h-full w-4 shrink-0 items-center justify-center font-mono text-[11px] font-semibold select-none ${
          line.type === "add"
            ? "text-success"
            : line.type === "del"
              ? "text-destructive"
              : "text-transparent"
        }`}
      >
        {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
      </span>

      {/* Code content */}
      <span className="text-text-primary flex-1 overflow-x-auto px-1 pr-3 font-mono whitespace-pre">
        {segments ? (
          <WordDiffContent
            segments={segments}
            type={line.type}
          />
        ) : (
          line.content
        )}
      </span>
    </div>
  );
}

function HunkHeaderRow({ content }: { content: string }) {
  return (
    <div className="border-border-subtle bg-diff-hunk-bg text-info sticky top-0 z-[1] flex h-5 items-center border-y px-3 font-mono text-[11px]">
      {content}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Word-level diff highlighting
// ---------------------------------------------------------------------------

function WordDiffContent({
  segments,
  type,
}: {
  segments: Array<{ text: string; type: "equal" | "change" }>;
  type: "add" | "del" | "context";
}) {
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "change") {
          return (
            <span
              key={`${seg.text.slice(0, 8)}-${i}`}
              className={`rounded-xs px-px ${
                type === "add" ? "bg-diff-add-word" : "bg-diff-del-word"
              }`}
            >
              {seg.text}
            </span>
          );
        }
        return <span key={`${seg.text.slice(0, 8)}-${i}`}>{seg.text}</span>;
      })}
    </>
  );
}
