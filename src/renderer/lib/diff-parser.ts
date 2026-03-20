export type DiffFileStatus = "added" | "deleted" | "modified" | "renamed";

export type DiffFile = {
  oldPath: string;
  newPath: string;
  status: DiffFileStatus;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
};

export type DiffHunk = {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
};

export type DiffLineType = "context" | "add" | "del" | "hunk-header";

export type DiffLine = {
  type: DiffLineType;
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
};

export type Segment = {
  text: string;
  type: "equal" | "change";
};

const DIFF_NULL_PATH = "/dev/null";

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

    const currentHunk = hunks[hunks.length - 1];
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
        newLineNumber: null, // assigned below
      });
    } else if (line.startsWith("-")) {
      deletions++;
      currentHunk.lines.push({
        type: "del",
        content: line.slice(1),
        oldLineNumber: null, // assigned below
        newLineNumber: null,
      });
    } else if (line.startsWith(" ")) {
      currentHunk.lines.push({
        type: "context",
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber: null,
      });
    } else if (line === "\\ No newline at end of file") {
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

  const status = resolveStatus(oldPath, newPath);

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
  const context = match[5]?.trim() ?? "";

  const hunkLine: DiffLine = {
    type: "hunk-header",
    content: context,
    oldLineNumber: null,
    newLineNumber: null,
  };

  return {
    header: line,
    oldStart,
    oldCount,
    newStart,
    newCount,
    lines: [hunkLine],
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
 * Uses a character-level LCS approach with prefix/suffix optimization.
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

  // Find common prefix
  let prefixLen = 0;
  const minLen = Math.min(oldLine.length, newLine.length);
  while (prefixLen < minLen && oldLine[prefixLen] === newLine[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix (not overlapping with prefix)
  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    oldLine[oldLine.length - 1 - suffixLen] === newLine[newLine.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const oldMiddle = oldLine.slice(prefixLen, oldLine.length - suffixLen);
  const newMiddle = newLine.slice(prefixLen, newLine.length - suffixLen);
  const prefix = oldLine.slice(0, prefixLen);
  const suffix = oldLine.slice(oldLine.length - suffixLen);

  const oldSegments: Segment[] = [];
  const newSegments: Segment[] = [];

  if (prefix) {
    oldSegments.push({ text: prefix, type: "equal" });
    newSegments.push({ text: prefix, type: "equal" });
  }

  if (oldMiddle) {
    oldSegments.push({ text: oldMiddle, type: "change" });
  }
  if (newMiddle) {
    newSegments.push({ text: newMiddle, type: "change" });
  }

  if (suffix) {
    oldSegments.push({ text: suffix, type: "equal" });
    newSegments.push({ text: suffix, type: "equal" });
  }

  return { oldSegments, newSegments };
}
