/* eslint-disable no-continue, no-inline-comments, no-negated-condition, @typescript-eslint/no-non-null-assertion -- The diff parser is a guarded single-pass parser where these patterns keep the control flow explicit. */
export type DiffFileStatus = "added" | "deleted" | "modified" | "renamed";

export interface DiffFile {
  oldPath: string;
  newPath: string;
  status: DiffFileStatus;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export type DiffLineType = "context" | "add" | "del" | "hunk-header";

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  segments?: Segment[];
  pairId?: number;
}

export interface Segment {
  text: string;
  type: "equal" | "change";
}

const DIFF_NULL_PATH = "/dev/null";
const WORD_DIFF_TOKEN_PATTERN = /\s+|[\p{L}\p{N}_$]+|[^\s\p{L}\p{N}_$]+/gu;
const WORD_DIFF_IDENTIFIER_PATTERN = /^[\p{L}\p{N}_$]+$/u;
const WORD_DIFF_WHITESPACE_PATTERN = /^\s+$/u;
const WORD_DIFF_OPERATOR_TOKENS = [
  ">>>=",
  "<<=",
  ">>=",
  "!==",
  "===",
  "...",
  "&&=",
  "||=",
  "??=",
  "**=",
  "=>",
  "->",
  "::",
  "?.",
  "??",
  "&&",
  "||",
  "==",
  "!=",
  "<=",
  ">=",
  "<<",
  ">>",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "**",
  "//",
  "/*",
  "*/",
] as const;
const CHANGED_LINE_PAIR_MIN_SIMILARITY = 0.28;
const CHANGED_LINE_PAIR_SKIP_PENALTY = 0.03;

type DiffTokenOperation =
  | { type: "equal"; text: string }
  | { type: "delete"; text: string }
  | { type: "insert"; text: string };

function pushSegment(segments: Segment[], text: string, type: Segment["type"]): void {
  if (!text) {
    return;
  }

  const previousSegment = segments.at(-1);
  if (previousSegment?.type === type) {
    previousSegment.text += text;
    return;
  }

  segments.push({ text, type });
}

/**
 * Parse a unified diff string into structured data.
 */
export function parseDiff(raw: string): DiffFile[] {
  if (!raw.trim()) {
    return [];
  }

  const files: DiffFile[] = [];
  const fileSections = splitByFiles(raw);

  for (const section of fileSections) {
    const file = parseFileSection(section);
    if (file) {
      files.push(file);
    }
  }

  return files;
}

/**
 * Split the raw diff into sections, one per file.
 * Each section starts with "diff --git".
 */
function splitByFiles(raw: string): string[] {
  const sections: string[] = [];
  const lines = raw.split("\n");
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current.length > 0) {
        sections.push(current.join("\n"));
      }
      current = [line];
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) {
    sections.push(current.join("\n"));
  }

  return sections;
}

/**
 * Parse a single file section from a unified diff.
 */
function parseFileSection(section: string): DiffFile | null {
  const lines = section.split("\n");

  // Skip binary files
  if (lines.some((l) => l.startsWith("Binary files") && l.includes("differ"))) {
    return null;
  }

  let oldPath = "";
  let newPath = "";
  const hunks: DiffHunk[] = [];
  let additions = 0;
  let deletions = 0;

  let i = 0;

  // Skip the "diff --git a/... b/..." line and metadata lines until we find --- or @@
  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith("--- ")) {
      oldPath = parseDiffPath(line.slice(4));
      i++;
      continue;
    }

    if (line.startsWith("+++ ")) {
      newPath = parseDiffPath(line.slice(4));
      i++;
      continue;
    }

    if (line.startsWith("@@ ")) {
      break;
    }

    i++;
  }

  // Parse hunks
  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith("@@ ")) {
      const hunk = parseHunkHeader(line);
      if (hunk) {
        hunks.push(hunk);
      }
      i++;
      continue;
    }

    const currentHunk = hunks.at(-1);
    if (!currentHunk) {
      i++;
      continue;
    }

    if (line.startsWith("+")) {
      additions++;
      currentHunk.lines.push({
        type: "add",
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber: null, // Assigned below
      });
    } else if (line.startsWith("-")) {
      deletions++;
      currentHunk.lines.push({
        type: "del",
        content: line.slice(1),
        oldLineNumber: null, // Assigned below
        newLineNumber: null,
      });
    } else if (line.startsWith(" ")) {
      currentHunk.lines.push({
        type: "context",
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber: null,
      });
    } else if (line === String.raw`\ No newline at end of file`) {
      // Skip this marker
    }

    i++;
  }

  // Assign line numbers within each hunk
  for (const hunk of hunks) {
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;

    for (const dl of hunk.lines) {
      switch (dl.type) {
        case "context": {
          dl.oldLineNumber = oldLine;
          dl.newLineNumber = newLine;
          oldLine++;
          newLine++;
          break;
        }
        case "add": {
          dl.newLineNumber = newLine;
          newLine++;
          break;
        }
        case "del": {
          dl.oldLineNumber = oldLine;
          oldLine++;
          break;
        }
        case "hunk-header": {
          break;
        }
      }
    }
  }

  // Pair remove/add runs and precompute word-diff segments for inline word highlighting.
  // This keeps rendering fast by avoiding repeated computeWordDiff calls on every repaint.
  for (const hunk of hunks) {
    let i = 0;
    let nextPairId = 0;
    while (i < hunk.lines.length) {
      const current = hunk.lines[i];
      if (!current || current.type !== "del") {
        i++;
        continue;
      }

      const removedLines: DiffLine[] = [];
      while (i < hunk.lines.length && hunk.lines[i]?.type === "del") {
        const line = hunk.lines[i];
        if (line) {
          removedLines.push(line);
        }
        i++;
      }

      const addedLines: DiffLine[] = [];
      while (i < hunk.lines.length && hunk.lines[i]?.type === "add") {
        const line = hunk.lines[i];
        if (line) {
          addedLines.push(line);
        }
        i++;
      }

      const pairings = pairChangedLines(removedLines, addedLines);
      for (const [removedIndex, addedIndex] of pairings) {
        const removeLine = removedLines[removedIndex];
        const addLine = addedLines[addedIndex];
        if (!removeLine || !addLine) {
          continue;
        }
        const { oldSegments, newSegments } = computeWordDiff(removeLine.content, addLine.content);
        removeLine.segments = oldSegments;
        addLine.segments = newSegments;
        removeLine.pairId = nextPairId;
        addLine.pairId = nextPairId;
        nextPairId++;
      }
    }
  }

  // If we couldn't find --- / +++ lines, try to extract paths from the
  // "diff --git a/path b/path" header. This handles rename-only, mode-change,
  // And other diffs that lack content headers.
  if (!oldPath && !newPath) {
    const gitLine = lines[0] ?? "";
    const gitMatch = gitLine.match(/^diff --git a\/(.+?) b\/(.+?)$/);
    if (gitMatch) {
      oldPath = gitMatch[1]!;
      newPath = gitMatch[2]!;
    }
  }

  // Skip entries where we still can't determine a path (corrupt diff sections)
  if (!oldPath && !newPath) {
    return null;
  }

  const status = resolveStatus(oldPath, newPath);

  // Skip files with no actual content changes (pure mode changes etc.) and no hunks
  if (hunks.length === 0 && additions === 0 && deletions === 0) {
    return null;
  }

  return {
    oldPath,
    newPath,
    status,
    hunks,
    additions,
    deletions,
  };
}

/**
 * Parse a path from a --- or +++ line.
 * Strips the leading "a/" or "b/" prefix.
 * Returns "/dev/null" as-is.
 */
function parseDiffPath(raw: string): string {
  const trimmed = raw.trim();

  if (trimmed === DIFF_NULL_PATH) {
    return DIFF_NULL_PATH;
  }

  // Strip "a/" or "b/" prefix
  if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) {
    return trimmed.slice(2);
  }

  return trimmed;
}

/**
 * Returns the real file path for a diff file, ignoring the /dev/null sentinel
 * used for added and deleted files in unified diffs.
 */
export function getDiffFilePath(file: Pick<DiffFile, "oldPath" | "newPath">): string {
  if (file.newPath && file.newPath !== DIFF_NULL_PATH) {
    return file.newPath;
  }
  if (file.oldPath && file.oldPath !== DIFF_NULL_PATH) {
    return file.oldPath;
  }
  return file.newPath || file.oldPath;
}

/**
 * Parse a hunk header line like "@@ -1,5 +1,7 @@ optional context".
 */
function parseHunkHeader(line: string): DiffHunk | null {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
  if (!match) {
    return null;
  }

  const oldStart = Number.parseInt(match[1]!, 10);
  const oldCount = match[2] !== undefined ? Number.parseInt(match[2], 10) : 1;
  const newStart = Number.parseInt(match[3]!, 10);
  const newCount = match[4] !== undefined ? Number.parseInt(match[4], 10) : 1;
  return {
    header: line,
    oldStart,
    oldCount,
    newStart,
    newCount,
    lines: [],
  };
}

/**
 * Determine the status of a diff file based on its paths.
 */
function resolveStatus(oldPath: string, newPath: string): DiffFileStatus {
  if (oldPath === DIFF_NULL_PATH) {
    return "added";
  }
  if (newPath === DIFF_NULL_PATH) {
    return "deleted";
  }
  if (oldPath !== newPath) {
    return "renamed";
  }
  return "modified";
}

/**
 * Compute word-level diff segments between two lines for inline highlighting.
 * Uses token-level LCS so changed identifiers/operators are highlighted as whole units.
 */
export function computeWordDiff(
  oldLine: string,
  newLine: string,
): { oldSegments: Segment[]; newSegments: Segment[] } {
  if (oldLine === newLine) {
    return {
      oldSegments: oldLine ? [{ text: oldLine, type: "equal" }] : [],
      newSegments: newLine ? [{ text: newLine, type: "equal" }] : [],
    };
  }

  if (!oldLine) {
    return {
      oldSegments: [],
      newSegments: newLine ? [{ text: newLine, type: "change" }] : [],
    };
  }

  if (!newLine) {
    return {
      oldSegments: oldLine ? [{ text: oldLine, type: "change" }] : [],
      newSegments: [],
    };
  }

  const oldTokens = tokenizeWordDiffLine(oldLine);
  const newTokens = tokenizeWordDiffLine(newLine);

  if (oldTokens.length === 0 || newTokens.length === 0) {
    return {
      oldSegments: oldLine ? [{ text: oldLine, type: "change" }] : [],
      newSegments: newLine ? [{ text: newLine, type: "change" }] : [],
    };
  }

  let prefixTokenCount = 0;
  const minTokenCount = Math.min(oldTokens.length, newTokens.length);
  while (
    prefixTokenCount < minTokenCount &&
    oldTokens[prefixTokenCount] === newTokens[prefixTokenCount]
  ) {
    prefixTokenCount++;
  }

  let oldSuffixStart = oldTokens.length;
  let newSuffixStart = newTokens.length;
  while (
    oldSuffixStart > prefixTokenCount &&
    newSuffixStart > prefixTokenCount &&
    oldTokens[oldSuffixStart - 1] === newTokens[newSuffixStart - 1]
  ) {
    oldSuffixStart--;
    newSuffixStart--;
  }

  const oldSegments: Segment[] = [];
  const newSegments: Segment[] = [];

  for (let tokenIndex = 0; tokenIndex < prefixTokenCount; tokenIndex++) {
    const token = oldTokens[tokenIndex];
    if (token) {
      pushSegment(oldSegments, token, "equal");
      pushSegment(newSegments, token, "equal");
    }
  }

  const middleOperations = diffTokenSequences(
    oldTokens.slice(prefixTokenCount, oldSuffixStart),
    newTokens.slice(prefixTokenCount, newSuffixStart),
  );

  for (const operation of middleOperations) {
    switch (operation.type) {
      case "equal": {
        pushSegment(oldSegments, operation.text, "equal");
        pushSegment(newSegments, operation.text, "equal");
        break;
      }
      case "delete": {
        pushSegment(oldSegments, operation.text, "change");
        break;
      }
      case "insert": {
        pushSegment(newSegments, operation.text, "change");
        break;
      }
    }
  }

  for (let tokenIndex = oldSuffixStart; tokenIndex < oldTokens.length; tokenIndex++) {
    const token = oldTokens[tokenIndex];
    if (token) {
      pushSegment(oldSegments, token, "equal");
      pushSegment(newSegments, token, "equal");
    }
  }

  return { oldSegments, newSegments };
}

function tokenizeWordDiffLine(line: string): string[] {
  const coarseTokens = line.match(WORD_DIFF_TOKEN_PATTERN) ?? [];
  const tokens: string[] = [];

  for (const token of coarseTokens) {
    if (WORD_DIFF_WHITESPACE_PATTERN.test(token) || !WORD_DIFF_IDENTIFIER_PATTERN.test(token)) {
      tokens.push(...splitPunctuationToken(token));
      continue;
    }

    tokens.push(...splitIdentifierToken(token));
  }

  return tokens;
}

function splitPunctuationToken(token: string): string[] {
  if (WORD_DIFF_WHITESPACE_PATTERN.test(token) || token.length <= 1) {
    return [token];
  }

  const parts: string[] = [];
  let index = 0;

  while (index < token.length) {
    let operatorToken: (typeof WORD_DIFF_OPERATOR_TOKENS)[number] | null = null;
    for (const candidate of WORD_DIFF_OPERATOR_TOKENS) {
      if (token.startsWith(candidate, index)) {
        operatorToken = candidate;
        break;
      }
    }

    if (operatorToken) {
      parts.push(operatorToken);
      index += operatorToken.length;
      continue;
    }

    parts.push(token[index]!);
    index++;
  }

  return parts;
}

function diffTokenSequences(oldTokens: string[], newTokens: string[]): DiffTokenOperation[] {
  if (oldTokens.length === 0) {
    return newTokens.map((token) => ({ type: "insert", text: token }));
  }

  if (newTokens.length === 0) {
    return oldTokens.map((token) => ({ type: "delete", text: token }));
  }

  const lcsTable = Array.from(
    { length: oldTokens.length + 1 },
    () => new Uint16Array(newTokens.length + 1),
  );

  for (let oldIndex = 1; oldIndex <= oldTokens.length; oldIndex++) {
    for (let newIndex = 1; newIndex <= newTokens.length; newIndex++) {
      lcsTable[oldIndex]![newIndex] =
        oldTokens[oldIndex - 1] === newTokens[newIndex - 1]
          ? lcsTable[oldIndex - 1]![newIndex - 1]! + 1
          : Math.max(lcsTable[oldIndex - 1]![newIndex]!, lcsTable[oldIndex]![newIndex - 1]!);
    }
  }

  const operations: DiffTokenOperation[] = [];
  let oldIndex = oldTokens.length;
  let newIndex = newTokens.length;

  while (oldIndex > 0 && newIndex > 0) {
    const oldToken = oldTokens[oldIndex - 1];
    const newToken = newTokens[newIndex - 1];

    if (oldToken === newToken) {
      operations.push({ type: "equal", text: oldToken! });
      oldIndex--;
      newIndex--;
      continue;
    }

    if (lcsTable[oldIndex - 1]![newIndex]! >= lcsTable[oldIndex]![newIndex - 1]!) {
      operations.push({ type: "delete", text: oldToken! });
      oldIndex--;
    } else {
      operations.push({ type: "insert", text: newToken! });
      newIndex--;
    }
  }

  while (oldIndex > 0) {
    operations.push({ type: "delete", text: oldTokens[oldIndex - 1]! });
    oldIndex--;
  }

  while (newIndex > 0) {
    operations.push({ type: "insert", text: newTokens[newIndex - 1]! });
    newIndex--;
  }

  operations.reverse();
  return operations;
}

function splitIdentifierToken(token: string): string[] {
  if (token.length <= 1) {
    return [token];
  }

  const parts: string[] = [];
  let current = "";

  for (let index = 0; index < token.length; index++) {
    const character = token[index]!;
    const previousCharacter = token[index - 1];
    const nextCharacter = token[index + 1];

    if (character === "_" || character === "$") {
      if (current) {
        parts.push(current);
        current = "";
      }
      parts.push(character);
      continue;
    }

    if (!current) {
      current = character;
      continue;
    }

    if (shouldSplitIdentifier(previousCharacter, character, nextCharacter)) {
      parts.push(current);
      current = character;
      continue;
    }

    current += character;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

function shouldSplitIdentifier(
  previousCharacter: string | undefined,
  character: string,
  nextCharacter: string | undefined,
): boolean {
  if (!previousCharacter || previousCharacter === "_" || previousCharacter === "$") {
    return false;
  }

  return (
    (isLowercaseOrDigit(previousCharacter) && isUppercaseLetter(character)) ||
    (isUppercaseLetter(previousCharacter) &&
      isUppercaseLetter(character) &&
      nextCharacter !== undefined &&
      isLowercaseLetter(nextCharacter)) ||
    (isLetter(previousCharacter) && isDigit(character)) ||
    (isDigit(previousCharacter) && isLetter(character))
  );
}

function isLetter(character: string): boolean {
  return /^\p{L}$/u.test(character);
}

function isLowercaseLetter(character: string): boolean {
  return /^\p{Lowercase_Letter}$/u.test(character);
}

function isUppercaseLetter(character: string): boolean {
  return /^\p{Uppercase_Letter}$/u.test(character);
}

function isDigit(character: string): boolean {
  return /^\p{N}$/u.test(character);
}

function isLowercaseOrDigit(character: string): boolean {
  return isLowercaseLetter(character) || isDigit(character);
}

function pairChangedLines(
  removedLines: DiffLine[],
  addedLines: DiffLine[],
): Array<[number, number]> {
  if (removedLines.length === 0 || addedLines.length === 0) {
    return [];
  }

  const similarityMatrix = removedLines.map((removedLine) =>
    addedLines.map((addedLine) =>
      computeLinePairSimilarity(removedLine.content, addedLine.content),
    ),
  );

  const scores = Array.from(
    { length: removedLines.length + 1 },
    () => new Float64Array(addedLines.length + 1),
  );
  const moves = Array.from({ length: removedLines.length + 1 }, () =>
    Array.from({ length: addedLines.length + 1 }, () => "skip-add" as const),
  );

  for (let removedIndex = 1; removedIndex <= removedLines.length; removedIndex++) {
    moves[removedIndex]![0] = "skip-remove";
  }

  for (let removedIndex = 1; removedIndex <= removedLines.length; removedIndex++) {
    for (let addedIndex = 1; addedIndex <= addedLines.length; addedIndex++) {
      const similarity = similarityMatrix[removedIndex - 1]?.[addedIndex - 1] ?? 0;
      const pairScore =
        similarity >= CHANGED_LINE_PAIR_MIN_SIMILARITY
          ? scores[removedIndex - 1]![addedIndex - 1]! + similarity
          : Number.NEGATIVE_INFINITY;
      const skipRemoveScore = Math.max(
        0,
        scores[removedIndex - 1]![addedIndex]! - CHANGED_LINE_PAIR_SKIP_PENALTY,
      );
      const skipAddScore = Math.max(
        0,
        scores[removedIndex]![addedIndex - 1]! - CHANGED_LINE_PAIR_SKIP_PENALTY,
      );

      if (pairScore >= skipRemoveScore && pairScore >= skipAddScore) {
        scores[removedIndex]![addedIndex] = pairScore;
        moves[removedIndex]![addedIndex] = "pair";
      } else if (skipRemoveScore >= skipAddScore) {
        scores[removedIndex]![addedIndex] = skipRemoveScore;
        moves[removedIndex]![addedIndex] = "skip-remove";
      } else {
        scores[removedIndex]![addedIndex] = skipAddScore;
        moves[removedIndex]![addedIndex] = "skip-add";
      }
    }
  }

  const pairings: Array<[number, number]> = [];
  let removedIndex = removedLines.length;
  let addedIndex = addedLines.length;

  while (removedIndex > 0 && addedIndex > 0) {
    const move = moves[removedIndex]![addedIndex];

    if (move === "pair") {
      pairings.push([removedIndex - 1, addedIndex - 1]);
      removedIndex--;
      addedIndex--;
      continue;
    }

    if (move === "skip-remove") {
      removedIndex--;
    } else {
      addedIndex--;
    }
  }

  pairings.reverse();
  return pairings;
}

function computeLinePairSimilarity(oldLine: string, newLine: string): number {
  if (oldLine === newLine) {
    return 1;
  }

  const oldTokens = tokenizeWordDiffLine(oldLine).filter((token) =>
    isSignificantWordDiffToken(token),
  );
  const newTokens = tokenizeWordDiffLine(newLine).filter((token) =>
    isSignificantWordDiffToken(token),
  );

  if (oldTokens.length === 0 || newTokens.length === 0) {
    return 0;
  }

  const operations = diffTokenSequences(oldTokens, newTokens);
  const sharedLength = operations.reduce(
    (length, operation) => (operation.type === "equal" ? length + operation.text.length : length),
    0,
  );
  const sharedTokenCount = operations.reduce(
    (count, operation) => (operation.type === "equal" ? count + 1 : count),
    0,
  );
  const oldLength = oldTokens.reduce((length, token) => length + token.length, 0);
  const newLength = newTokens.reduce((length, token) => length + token.length, 0);
  const characterSimilarity = sharedLength / Math.max(oldLength, newLength);
  const tokenSimilarity = sharedTokenCount / Math.max(oldTokens.length, newTokens.length);
  const boundarySimilarity = computeBoundaryTokenSimilarity(oldTokens, newTokens);
  const indentationSimilarity = oldLine.match(/^\s*/)?.[0] === newLine.match(/^\s*/)?.[0] ? 1 : 0;

  return Math.min(
    1,
    characterSimilarity * 0.55 +
      tokenSimilarity * 0.25 +
      boundarySimilarity * 0.15 +
      indentationSimilarity * 0.05,
  );
}

function isSignificantWordDiffToken(token: string): boolean {
  return (
    !WORD_DIFF_WHITESPACE_PATTERN.test(token) &&
    (WORD_DIFF_IDENTIFIER_PATTERN.test(token) || token.length > 1)
  );
}

function computeBoundaryTokenSimilarity(oldTokens: string[], newTokens: string[]): number {
  const minLength = Math.min(oldTokens.length, newTokens.length);
  if (minLength === 0) {
    return 0;
  }

  let prefixMatches = 0;
  while (prefixMatches < minLength && oldTokens[prefixMatches] === newTokens[prefixMatches]) {
    prefixMatches++;
  }

  let suffixMatches = 0;
  while (
    suffixMatches < minLength - prefixMatches &&
    oldTokens[oldTokens.length - 1 - suffixMatches] ===
      newTokens[newTokens.length - 1 - suffixMatches]
  ) {
    suffixMatches++;
  }

  return (prefixMatches + suffixMatches) / minLength;
}
