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

const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_PRIME = 16_777_619;

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
    input.diffSnippet.slice(0, 3000),
  ].join("\n---\n");

  return hashString(normalizedSnapshot);
}

export function buildAiReviewSummaryPrompt(input: AiReviewSummarySnapshotInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const fileList = input.files
    .slice(0, 30)
    .map((file) => `  ${file.path} (+${file.additions}, -${file.deletions})`)
    .join("\n");

  return {
    systemPrompt:
      'You write pull request sidebar summaries for a busy reviewer. Return strict JSON only in the shape {"summary":"markdown"}. The summary must be markdown with at most 3 bullets and under 90 words. Do not restate the PR title, author, or description. Focus on the code changes and the one or two areas that deserve review attention. If there is no notable risk, omit the risk bullet.',
    userPrompt: `PR: ${input.prTitle} #${input.prNumber}\nAuthor: ${input.author}\n\nDescription:\n${input.prBody}\n\nFiles changed:\n${fileList}\n\nDiff (first 3000 chars):\n${input.diffSnippet.slice(0, 3000)}`,
  };
}

export function buildAiReviewConfidencePrompt(input: AiReviewSummarySnapshotInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const fileList = input.files
    .slice(0, 30)
    .map((file) => `  ${file.path} (+${file.additions}, -${file.deletions})`)
    .join("\n");

  return {
    systemPrompt:
      'You assess how confidently a pull request can be summarized from limited review context. Return strict JSON only in the shape {"confidenceScore":72}. confidenceScore must be an integer from 0 to 100. Lower the score when the diff is broad, noisy, risky, or hard to assess from the provided snippet. Higher scores mean the important review surface is visible from the provided files and diff context.',
    userPrompt: `PR: ${input.prTitle} #${input.prNumber}\nAuthor: ${input.author}\n\nDescription:\n${input.prBody}\n\nFiles changed:\n${fileList}\n\nDiff (first 3000 chars):\n${input.diffSnippet.slice(0, 3000)}`,
  };
}

export function parseAiReviewSummaryPayload(raw: string): AiReviewSummaryPayload | null {
  const json = extractJsonObject(raw);
  if (!json) {
    return null;
  }

  const parsed: unknown = (() => {
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  })();

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const candidate = parsed as {
    summary?: unknown;
  };
  const summary = typeof candidate.summary === "string" ? candidate.summary.trim() : "";

  if (!summary) {
    return null;
  }

  return {
    summary,
  };
}

export function parseAiReviewConfidencePayload(raw: string): AiReviewConfidencePayload | null {
  const json = extractJsonObject(raw);
  if (!json) {
    return null;
  }

  const parsed: unknown = (() => {
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  })();

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const candidate = parsed as {
    confidenceScore?: unknown;
  };
  const confidenceValue = candidate.confidenceScore;
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
