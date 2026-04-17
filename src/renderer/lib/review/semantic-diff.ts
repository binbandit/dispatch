import type { DiffFile, DiffLine, Segment } from "@/renderer/lib/review/diff-parser";

/**
 * Semantic-diff signals surface refactor patterns that would otherwise be buried
 * inside a line-by-line diff. They let reviewers skip past noise and focus on
 * the substantive change — or confirm there is none.
 */
export type SemanticSignal =
  | { kind: "pure-rename"; from: string; to: string }
  | { kind: "whitespace-only"; changedLines: number }
  | { kind: "identifier-rename"; from: string; to: string; occurrences: number };

const IDENTIFIER_PATTERN = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;
const WHITESPACE_PATTERN = /\s+/g;
const MIN_IDENTIFIER_RENAME_PAIRS = 2;

export function analyzeSemanticDiff(file: DiffFile): SemanticSignal[] {
  const signals: SemanticSignal[] = [];

  if (file.status === "renamed" && file.additions === 0 && file.deletions === 0) {
    signals.push({ kind: "pure-rename", from: file.oldPath, to: file.newPath });
    return signals;
  }

  const whitespaceOnly = detectWhitespaceOnly(file);
  if (whitespaceOnly !== null) {
    signals.push({ kind: "whitespace-only", changedLines: whitespaceOnly });
  }

  const identifierRename = detectIdentifierRename(file);
  if (identifierRename !== null) {
    signals.push(identifierRename);
  }

  return signals;
}

function detectWhitespaceOnly(file: DiffFile): number | null {
  if (file.additions === 0 || file.deletions === 0) {
    return null;
  }

  let deletedContent = "";
  let addedContent = "";
  let changedLines = 0;

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "del") {
        deletedContent += line.content.replace(WHITESPACE_PATTERN, "");
        changedLines++;
      } else if (line.type === "add") {
        addedContent += line.content.replace(WHITESPACE_PATTERN, "");
        changedLines++;
      }
    }
  }

  return deletedContent === addedContent && changedLines > 0 ? changedLines : null;
}

function detectIdentifierRename(file: DiffFile): SemanticSignal | null {
  const pairs = collectPairs(file);
  if (pairs.length < MIN_IDENTIFIER_RENAME_PAIRS) {
    return null;
  }

  let fromToken: string | null = null;
  let toToken: string | null = null;
  let occurrences = 0;

  for (const { del, add } of pairs) {
    if (!del.segments || !add.segments) {
      return null;
    }

    const delBlocks = extractContiguousChangeBlocks(del.segments).map((block) =>
      expandToIdentifier(del.content, block.startOffset, block.text.length),
    );
    const addBlocks = extractContiguousChangeBlocks(add.segments).map((block) =>
      expandToIdentifier(add.content, block.startOffset, block.text.length),
    );

    if (delBlocks.length === 0 || addBlocks.length === 0 || delBlocks.length !== addBlocks.length) {
      return null;
    }

    const [delToken] = delBlocks;
    const [addToken] = addBlocks;
    if (delToken === undefined || addToken === undefined) {
      return null;
    }
    if (delBlocks.some((token) => token !== delToken)) {
      return null;
    }
    if (addBlocks.some((token) => token !== addToken)) {
      return null;
    }

    if (!IDENTIFIER_PATTERN.test(delToken) || !IDENTIFIER_PATTERN.test(addToken)) {
      return null;
    }

    if (fromToken === null) {
      fromToken = delToken;
      toToken = addToken;
    } else if (fromToken !== delToken || toToken !== addToken) {
      return null;
    }

    occurrences += delBlocks.length;
  }

  if (fromToken === null || toToken === null) {
    return null;
  }

  return { kind: "identifier-rename", from: fromToken, to: toToken, occurrences };
}

interface ChangeBlock {
  text: string;
  startOffset: number;
}

const IDENTIFIER_CHAR_PATTERN = /^[\p{L}\p{N}_$]$/u;

function extractContiguousChangeBlocks(segments: Segment[]): ChangeBlock[] {
  const blocks: ChangeBlock[] = [];
  let offset = 0;
  let currentText = "";
  let currentStart = -1;

  for (const segment of segments) {
    if (segment.type === "change") {
      if (currentText === "") {
        currentStart = offset;
      }
      currentText += segment.text;
    } else if (currentText) {
      blocks.push({ text: currentText, startOffset: currentStart });
      currentText = "";
      currentStart = -1;
    }
    offset += segment.text.length;
  }

  if (currentText) {
    blocks.push({ text: currentText, startOffset: currentStart });
  }

  return blocks;
}

function expandToIdentifier(content: string, offset: number, length: number): string {
  let start = offset;
  let end = offset + length;
  while (start > 0 && IDENTIFIER_CHAR_PATTERN.test(content[start - 1] ?? "")) {
    start--;
  }
  while (end < content.length && IDENTIFIER_CHAR_PATTERN.test(content[end] ?? "")) {
    end++;
  }
  return content.slice(start, end);
}

function collectPairs(file: DiffFile): Array<{ del: DiffLine; add: DiffLine }> {
  const pairMap = new Map<string, { del?: DiffLine; add?: DiffLine }>();

  file.hunks.forEach((hunk, hunkIndex) => {
    for (const line of hunk.lines) {
      if (line.pairId !== undefined) {
        const pairKey = `${hunkIndex}:${line.pairId}`;
        const bucket = pairMap.get(pairKey) ?? {};
        if (line.type === "del") {
          bucket.del = line;
        } else if (line.type === "add") {
          bucket.add = line;
        }
        pairMap.set(pairKey, bucket);
      }
    }
  });

  const pairs: Array<{ del: DiffLine; add: DiffLine }> = [];
  for (const bucket of pairMap.values()) {
    if (bucket.del && bucket.add) {
      pairs.push({ del: bucket.del, add: bucket.add });
    }
  }
  return pairs;
}
