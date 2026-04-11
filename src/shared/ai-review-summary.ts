export interface AiReviewSummarySnapshotInput {
  prNumber: number;
  prTitle: string;
  prBody: string;
  author: string;
  files: ReadonlyArray<{ path: string; additions: number; deletions: number }>;
  diffSnippet: string;
}

export interface AiReviewSummaryPayload {
  summary: string;
}

export interface AiReviewConfidencePayload {
  confidenceScore: number;
}

export interface AiReviewContext {
  diffExcerpt: string;
  coveredFiles: number;
  totalFiles: number;
  usedDiffChars: number;
  totalDiffChars: number;
  truncated: boolean;
  includesPrDescription: boolean;
  includesChangedFiles: boolean;
  includesWholeCodebase: false;
}

const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_PRIME = 16_777_619;
const AI_REVIEW_DIFF_BUDGET = 12_000;
const AI_REVIEW_BASELINE_CHARS_PER_FILE = 320;
const AI_REVIEW_MAX_CHARS_PER_FILE = 1600;
const AI_REVIEW_MAX_FILE_LIST_ITEMS = 30;

function hashString(value: string): string {
  let hash = FNV_OFFSET_BASIS;

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, FNV_PRIME);
  }

  return (new Uint32Array([hash])[0] ?? 0).toString(16).padStart(8, "0");
}

function extractJsonObject(raw: string): string | null {
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const candidate = (fencedMatch?.[1] ?? raw).trim();
  const startIndex = candidate.indexOf("{");
  const endIndex = candidate.lastIndexOf("}");

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return null;
  }

  return candidate.slice(startIndex, endIndex + 1);
}

function consumeLooseJsonEscape(
  value: string,
  index: number,
): {
  decoded: string;
  nextIndex: number;
} {
  const nextCharacter = value[index + 1];

  if (nextCharacter === undefined) {
    return {
      decoded: "\\",
      nextIndex: index,
    };
  }

  if (nextCharacter === '"' || nextCharacter === "\\" || nextCharacter === "/") {
    return {
      decoded: nextCharacter,
      nextIndex: index + 1,
    };
  }

  if (nextCharacter === "b") {
    return {
      decoded: "\b",
      nextIndex: index + 1,
    };
  }

  if (nextCharacter === "f") {
    return {
      decoded: "\f",
      nextIndex: index + 1,
    };
  }

  if (nextCharacter === "n") {
    return {
      decoded: "\n",
      nextIndex: index + 1,
    };
  }

  if (nextCharacter === "r") {
    return {
      decoded: "\r",
      nextIndex: index + 1,
    };
  }

  if (nextCharacter === "t") {
    return {
      decoded: "\t",
      nextIndex: index + 1,
    };
  }

  if (nextCharacter === "u") {
    const codePoint = value.slice(index + 2, index + 6);
    if (/^[\da-fA-F]{4}$/u.test(codePoint)) {
      return {
        decoded: String.fromCodePoint(Number.parseInt(codePoint, 16)),
        nextIndex: index + 5,
      };
    }

    return {
      decoded: "u",
      nextIndex: index + 1,
    };
  }

  return {
    decoded: nextCharacter,
    nextIndex: index + 1,
  };
}

function decodeLooseJsonString(value: string): string {
  let decoded = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character === "\\") {
      const escape = consumeLooseJsonEscape(value, index);
      decoded += escape.decoded;
      index = escape.nextIndex;
    } else {
      decoded += character;
    }
  }

  return decoded;
}

function extractLooseJsonStringField(raw: string, key: string): string | null {
  const keyPattern = new RegExp(`"${key}"\\s*:\\s*"`, "u");
  const match = keyPattern.exec(raw);

  if (!match) {
    return null;
  }

  let value = "";
  let index = match.index + match[0].length;

  while (index < raw.length) {
    const character = raw[index];

    if (character === "\\") {
      value += character;
      index += 1;
      if (index < raw.length) {
        value += raw[index];
        index += 1;
      }
    } else {
      if (character === '"') {
        const remainder = raw.slice(index + 1).trimStart();
        if (remainder.startsWith("}") || remainder.startsWith(",")) {
          return decodeLooseJsonString(value).trim();
        }
      }

      value += character;
      index += 1;
    }
  }

  return null;
}

function extractLooseJsonIntegerField(raw: string, key: string): number | null {
  const match = raw.match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+)`, "u"));
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function extractFallbackSummary(raw: string): string | null {
  const fencedMatch = raw.match(/```(?:markdown|md|text)?\s*([\s\S]*?)```/iu);
  const candidate = (fencedMatch?.[1] ?? raw).trim();
  const markdownListPattern = /^(?:[-*]\s.+|\d+\.\s.+)(?:\n(?:[-*]\s.+|\d+\.\s.+))*$/u;

  if (
    !candidate ||
    candidate.includes("{") ||
    candidate.includes('"summary"') ||
    !markdownListPattern.test(candidate)
  ) {
    return null;
  }

  return candidate;
}

export function buildAiReviewSummarySnapshotKey(input: AiReviewSummarySnapshotInput): string {
  const normalizedFiles = input.files
    .toSorted((left, right) => left.path.localeCompare(right.path))
    .map((file) => `${file.path}:${file.additions}:${file.deletions}`)
    .join("\n");
  const normalizedSnapshot = [
    input.prNumber,
    input.prTitle.trim(),
    input.prBody.trim(),
    input.author.trim(),
    normalizedFiles,
    input.diffSnippet,
  ].join("\n---\n");

  return hashString(normalizedSnapshot);
}

export function buildAiReviewContext(
  input: AiReviewSummarySnapshotInput,
  diffBudget = AI_REVIEW_DIFF_BUDGET,
): AiReviewContext {
  const diffSections = splitDiffSections(input.diffSnippet);
  const totalFiles = Math.max(input.files.length, diffSections.length);
  const totalDiffChars = input.diffSnippet.length;
  const includesPrDescription = input.prBody.trim().length > 0;
  const includesChangedFiles = input.files.length > 0;

  if (diffSections.length === 0) {
    return {
      diffExcerpt: input.diffSnippet.slice(0, diffBudget),
      coveredFiles: totalDiffChars > 0 ? 1 : 0,
      totalFiles,
      usedDiffChars: Math.min(totalDiffChars, diffBudget),
      totalDiffChars,
      truncated: totalDiffChars > diffBudget,
      includesPrDescription,
      includesChangedFiles,
      includesWholeCodebase: false,
    };
  }

  const fileScores = new Map(
    input.files.map((file) => [file.path, file.additions + file.deletions] as const),
  );
  const rankedSections = diffSections
    .map((section) => ({
      ...section,
      score: fileScores.get(section.path) ?? section.content.length,
    }))
    .toSorted((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.path.localeCompare(right.path);
    });

  const excerptLengths = new Map<string, number>();
  let remaining = diffBudget;

  for (const section of rankedSections) {
    if (remaining <= 0) {
      break;
    }

    const nextLength = Math.min(
      section.content.length,
      AI_REVIEW_BASELINE_CHARS_PER_FILE,
      remaining,
    );
    excerptLengths.set(section.path, nextLength);
    remaining -= nextLength;
  }

  for (const section of rankedSections) {
    if (remaining <= 0) {
      break;
    }

    const currentLength = excerptLengths.get(section.path) ?? 0;
    if (currentLength < section.content.length && currentLength < AI_REVIEW_MAX_CHARS_PER_FILE) {
      const nextLength = Math.min(
        section.content.length,
        AI_REVIEW_MAX_CHARS_PER_FILE,
        currentLength + remaining,
      );
      remaining -= nextLength - currentLength;
      excerptLengths.set(section.path, nextLength);
    }
  }

  const visibleSections = rankedSections
    .map((section) => {
      const excerptLength = excerptLengths.get(section.path) ?? 0;
      if (excerptLength === 0) {
        return null;
      }

      const excerpt = section.content.slice(0, excerptLength);
      return excerptLength < section.content.length
        ? `${excerpt}\n... [truncated for summary context]`
        : excerpt;
    })
    .filter((section): section is string => section !== null);

  const usedDiffChars = [...excerptLengths.values()].reduce((sum, length) => sum + length, 0);

  return {
    diffExcerpt: visibleSections.join("\n\n"),
    coveredFiles: excerptLengths.size,
    totalFiles,
    usedDiffChars,
    totalDiffChars,
    truncated: usedDiffChars < totalDiffChars,
    includesPrDescription,
    includesChangedFiles,
    includesWholeCodebase: false,
  };
}

export function buildAiReviewSummaryPrompt(input: AiReviewSummarySnapshotInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const reviewContext = buildAiReviewContext(input);
  const fileList = formatFileList(input.files);

  return {
    systemPrompt:
      'You write pull request sidebar summaries for a busy reviewer. Return strict JSON only in the shape {"summary":"markdown"}. Escape line breaks inside JSON strings as \\n, never as literal newlines. The summary must be markdown with at most 3 bullets and under 90 words. Do not restate the PR title, author, or description. Focus on the code changes and the one or two areas that deserve review attention. If there is no notable risk, omit the risk bullet. Do not claim repository-wide understanding beyond the supplied review context.',
    userPrompt: buildPromptBody(input, fileList, reviewContext),
  };
}

export function buildAiReviewConfidencePrompt(input: AiReviewSummarySnapshotInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const reviewContext = buildAiReviewContext(input);
  const fileList = formatFileList(input.files);

  return {
    systemPrompt:
      'You assess how confidently a pull request can be summarized from limited review context. Return strict JSON only in the shape {"confidenceScore":72}. confidenceScore must be an integer from 0 to 100. Lower the score when the diff is broad, noisy, risky, or hard to assess from the provided context. Higher scores mean the important review surface is visible from the supplied changed files and diff excerpts. Penalize the score when the context is truncated or clearly partial.',
    userPrompt: buildPromptBody(input, fileList, reviewContext),
  };
}

export function parseAiReviewSummaryPayload(raw: string): AiReviewSummaryPayload | null {
  const json = extractJsonObject(raw);
  const parsed: unknown = json
    ? (() => {
        try {
          return JSON.parse(json);
        } catch {
          return null;
        }
      })()
    : null;
  const candidate =
    parsed && typeof parsed === "object"
      ? (parsed as {
          summary?: unknown;
        })
      : null;
  const summary =
    (typeof candidate?.summary === "string" ? candidate.summary.trim() : "") ||
    (json ? extractLooseJsonStringField(json, "summary") : null) ||
    extractFallbackSummary(raw) ||
    "";

  if (!summary) {
    return null;
  }

  return {
    summary,
  };
}

export function parseAiReviewConfidencePayload(raw: string): AiReviewConfidencePayload | null {
  const json = extractJsonObject(raw);
  const parsed: unknown = json
    ? (() => {
        try {
          return JSON.parse(json);
        } catch {
          return null;
        }
      })()
    : null;
  const candidate =
    parsed && typeof parsed === "object"
      ? (parsed as {
          confidenceScore?: unknown;
        })
      : null;
  const confidenceValue =
    candidate?.confidenceScore ??
    (json ? extractLooseJsonIntegerField(json, "confidenceScore") : null);
  const confidenceScore =
    typeof confidenceValue === "number" && Number.isInteger(confidenceValue)
      ? confidenceValue
      : null;

  if (confidenceScore === null || confidenceScore < 0 || confidenceScore > 100) {
    return null;
  }

  return {
    confidenceScore,
  };
}

function splitDiffSections(rawDiff: string): Array<{ path: string; content: string }> {
  if (!rawDiff.trim()) {
    return [];
  }

  const sections = rawDiff.split(/^diff --git /gmu).filter(Boolean);

  return sections.map((section) => {
    const content = section.startsWith("diff --git ") ? section : `diff --git ${section}`;
    const firstLine = content.split("\n", 1)[0] ?? "";
    const match = firstLine.match(/^diff --git a\/(.+?) b\/(.+)$/u);
    const oldPath = match?.[1] ?? "";
    const newPath = match?.[2] ?? "";
    const path = newPath || oldPath;

    return {
      path,
      content,
    };
  });
}

function buildPromptBody(
  input: AiReviewSummarySnapshotInput,
  fileList: string,
  reviewContext: AiReviewContext,
): string {
  const visibleFileCount = Math.min(input.files.length, AI_REVIEW_MAX_FILE_LIST_ITEMS);

  return [
    `PR: ${input.prTitle} #${input.prNumber}`,
    `Author: ${input.author}`,
    "",
    "Description:",
    input.prBody || "(none)",
    "",
    "Files changed:",
    fileList,
    "",
    "Review context available to you:",
    `- PR description: ${reviewContext.includesPrDescription ? "included" : "not provided"}`,
    `- Changed-file manifest: ${reviewContext.includesChangedFiles ? `${visibleFileCount}/${input.files.length} files included` : "not provided"}`,
    `- Diff coverage: ${reviewContext.coveredFiles}/${reviewContext.totalFiles} changed files`,
    `- Diff bytes: ${reviewContext.usedDiffChars}/${reviewContext.totalDiffChars}`,
    `- Whole-codebase context: not included`,
    reviewContext.truncated
      ? "- Context is truncated to fit the review budget."
      : "- Full diff context is included.",
    "",
    "Diff excerpts:",
    reviewContext.diffExcerpt || "(no diff excerpts available)",
  ].join("\n");
}

function formatFileList(
  files: ReadonlyArray<{ path: string; additions: number; deletions: number }>,
): string {
  if (files.length === 0) {
    return "(none)";
  }

  const visibleFiles = files
    .slice(0, AI_REVIEW_MAX_FILE_LIST_ITEMS)
    .map((file) => `  ${file.path} (+${file.additions}, -${file.deletions})`);
  if (visibleFiles.length < files.length) {
    visibleFiles.push(`  ... ${files.length - visibleFiles.length} more changed files omitted`);
  }

  return visibleFiles.join("\n");
}
