import type { ReviewComment } from "@/renderer/components/review/comments/inline-comment";
import type { Annotation } from "@/renderer/components/review/diff/ci-annotation";
import type { AiSuggestion } from "@/renderer/lib/review/ai-suggestions";

import { getDiffFilePath, type DiffFile, type DiffLine } from "@/renderer/lib/review/diff-parser";
import { getReviewPositionKey } from "@/renderer/lib/review/review-position";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type CommentSide = "LEFT" | "RIGHT";

export interface CommentTarget {
  line: number;
  side: CommentSide;
}

export interface CommentRange {
  startLine: number;
  endLine: number;
  side: CommentSide;
}

// ---------------------------------------------------------------------------
// Flat row model
// ---------------------------------------------------------------------------

export type FlatLine = DiffLine & { pairKey: string | null };

export type FlatRow =
  | { kind: "line"; key: string; line: FlatLine }
  | { kind: "comment"; key: string; comments: ReviewComment[] }
  | { kind: "annotation"; key: string; annotations: Annotation[] }
  | { kind: "composer"; key: string; startLine: number; endLine: number; side: CommentSide }
  | { kind: "ai-suggestion"; key: string; suggestions: AiSuggestion[] };

export type NonLineFlatRow = Exclude<FlatRow, { kind: "line" }>;

export type SplitRow =
  | { kind: "pair"; key: string; left: FlatLine | null; right: FlatLine | null }
  | NonLineFlatRow;

export interface FlatLineEntry {
  key: string;
  line: FlatLine;
}

interface RowDecorationArgs {
  comments: Map<string, ReviewComment[]>;
  annotations: Map<string, Annotation[]>;
  composerRange: CommentRange | null;
  aiSuggestions?: Map<string, AiSuggestion[]>;
}

interface RowBuilderArgs extends RowDecorationArgs {
  file: DiffFile;
}

interface FullFileRowBuilderArgs extends RowBuilderArgs {
  fullFileContent: string | null | undefined;
}

interface AppendLineRowsArgs extends RowDecorationArgs {
  rows: FlatRow[];
  filePath: string;
  lineEntry: FlatLineEntry;
}

interface PendingDeletedEntry {
  row: Extract<FlatRow, { kind: "line" }>;
  auxiliaryRows: NonLineFlatRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getCommentTarget(line: DiffLine): CommentTarget | null {
  if (line.type === "del" && line.oldLineNumber !== null) {
    return { line: line.oldLineNumber, side: "LEFT" };
  }

  if (line.type !== "hunk-header" && line.newLineNumber !== null) {
    return { line: line.newLineNumber, side: "RIGHT" };
  }

  return null;
}

function createFlatLineEntry(args: {
  prefix: "line" | "full";
  hunkIndex: number;
  lineIndex: number;
  line: DiffLine;
}): FlatLineEntry {
  return {
    key: `${args.prefix}-${args.hunkIndex}-${args.lineIndex}-${args.line.type}-${args.line.oldLineNumber ?? "x"}-${args.line.newLineNumber ?? "x"}`,
    line: {
      ...args.line,
      pairKey: args.line.pairId === undefined ? null : `pair-${args.hunkIndex}-${args.line.pairId}`,
    },
  };
}

function appendLineRows({
  rows,
  filePath,
  lineEntry,
  comments,
  annotations,
  composerRange,
  aiSuggestions,
}: AppendLineRowsArgs) {
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

// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------

export function buildRows({
  file,
  comments,
  annotations,
  composerRange,
  aiSuggestions,
}: RowBuilderArgs): FlatRow[] {
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
        appendLineRows({
          rows,
          filePath,
          lineEntry: createFlatLineEntry({
            prefix: "line",
            hunkIndex,
            lineIndex: i,
            line,
          }),
          comments,
          annotations,
          composerRange,
          aiSuggestions,
        });
      }
    }
    hunkIndex++;
  }

  return rows;
}

export function buildSplitRows(rows: FlatRow[]): SplitRow[] {
  const splitRows: SplitRow[] = [];
  const pendingDeleted: PendingDeletedEntry[] = [];
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

  const takeMatchedPendingDeleted = (pairKey: string): PendingDeletedEntry | null => {
    while (pendingDeleted[0]?.row.line.pairKey !== pairKey) {
      flushPendingDeletedAtIndex(0);
    }

    return pendingDeleted.shift() ?? null;
  };

  const appendMatchedPendingPair = (
    matchedPending: PendingDeletedEntry | null,
    row: Extract<FlatRow, { kind: "line" }>,
  ) => {
    if (!matchedPending) {
      return;
    }

    splitRows.push({
      kind: "pair",
      key: `${matchedPending.row.key}-${row.key}`,
      left: matchedPending.row.line,
      right: row.line,
    });
    splitRows.push(...matchedPending.auxiliaryRows);
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
          appendMatchedPendingPair(takeMatchedPendingDeleted(row.line.pairKey ?? ""), row);
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
          left: row.line,
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

function appendRemovedLines(
  removedBeforeNewLine: Map<number, FlatLineEntry[]>,
  anchorLine: number,
  removedLines: FlatLineEntry[],
) {
  if (removedLines.length === 0) {
    return;
  }

  const existing = removedBeforeNewLine.get(anchorLine) ?? [];
  existing.push(...removedLines);
  removedBeforeNewLine.set(anchorLine, existing);
}

function trackFullFileLine(args: {
  hunkIndex: number;
  lineIndex: number;
  line: DiffLine;
  newLineTracker: number;
  pendingRemoved: FlatLineEntry[];
  removedBeforeNewLine: Map<number, FlatLineEntry[]>;
  renderedNewLines: Map<number, FlatLineEntry>;
}): { newLineTracker: number; pendingRemoved: FlatLineEntry[] } {
  const lineEntry = createFlatLineEntry({
    prefix: "full",
    hunkIndex: args.hunkIndex,
    lineIndex: args.lineIndex,
    line: args.line,
  });

  if (args.line.type === "del") {
    return {
      newLineTracker: args.newLineTracker,
      pendingRemoved: [...args.pendingRemoved, lineEntry],
    };
  }

  appendRemovedLines(args.removedBeforeNewLine, args.newLineTracker, args.pendingRemoved);
  args.renderedNewLines.set(args.newLineTracker, lineEntry);

  return {
    newLineTracker: args.newLineTracker + 1,
    pendingRemoved: [],
  };
}

export function buildFullFileRows({
  file,
  fullFileContent,
  comments,
  annotations,
  composerRange,
  aiSuggestions,
}: FullFileRowBuilderArgs): FlatRow[] | null {
  if (fullFileContent === null || fullFileContent === undefined) {
    return null;
  }

  const rows: FlatRow[] = [];
  const filePath = getDiffFilePath(file);
  const fileLines = splitFileContentLines(fullFileContent);
  const renderedNewLines = new Map<number, FlatLineEntry>();
  const removedBeforeNewLine = new Map<number, FlatLineEntry[]>();

  for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex++) {
    const hunk = file.hunks[hunkIndex];
    if (hunk) {
      let newLineTracker = hunk.newStart;
      let pendingRemoved: FlatLineEntry[] = [];

      for (let lineIndex = 0; lineIndex < hunk.lines.length; lineIndex++) {
        const line = hunk.lines[lineIndex];
        if (line && line.type !== "hunk-header") {
          ({ newLineTracker, pendingRemoved } = trackFullFileLine({
            hunkIndex,
            lineIndex,
            line,
            newLineTracker,
            pendingRemoved,
            removedBeforeNewLine,
            renderedNewLines,
          }));
        }
      }

      appendRemovedLines(removedBeforeNewLine, newLineTracker, pendingRemoved);
    }
  }

  for (let lineIndex = 0; lineIndex < fileLines.length; lineIndex++) {
    const lineNumber = lineIndex + 1;
    const removedLines = removedBeforeNewLine.get(lineNumber);
    if (removedLines) {
      for (const removedLine of removedLines) {
        appendLineRows({
          rows,
          filePath,
          lineEntry: removedLine,
          comments,
          annotations,
          composerRange,
          aiSuggestions,
        });
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

    appendLineRows({
      rows,
      filePath,
      lineEntry,
      comments,
      annotations,
      composerRange,
      aiSuggestions,
    });
  }

  const trailingRemoved = removedBeforeNewLine.get(fileLines.length + 1);
  if (trailingRemoved) {
    for (const removedLine of trailingRemoved) {
      appendLineRows({
        rows,
        filePath,
        lineEntry: removedLine,
        comments,
        annotations,
        composerRange,
        aiSuggestions,
      });
    }
  }

  return rows;
}
