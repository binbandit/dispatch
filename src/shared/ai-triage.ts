export type AiTriageSectionTone = "attention" | "changed" | "lowRisk";
export type AiTriageSelectionId =
  | "core-logic"
  | "ui-ux"
  | "data-contracts"
  | "tests-validation"
  | "tooling-config"
  | "other-changes";

export interface AiTriageSnapshotFile {
  path: string;
  status: "added" | "deleted" | "modified" | "renamed";
  additions: number;
  deletions: number;
  commentCount: number;
  hasAnnotation: boolean;
  fallbackBucket: AiTriageSectionTone;
  note?: string;
}

export interface AiTriageSnapshotInput {
  prNumber: number;
  prTitle: string;
  prBody: string;
  author: string;
  files: ReadonlyArray<AiTriageSnapshotFile>;
}

export interface AiTriagePayloadSection {
  sectionId: AiTriageSelectionId;
  paths: string[];
}

export interface AiTriagePayload {
  sections: AiTriagePayloadSection[];
}

export interface AiTriageSelectionDefinition {
  id: AiTriageSelectionId;
  label: string;
  description: string;
  tone: AiTriageSectionTone;
}

const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_PRIME = 16_777_619;
const MAX_SECTION_COUNT = 6;

export const AI_TRIAGE_SELECTION_DEFINITIONS: readonly AiTriageSelectionDefinition[] = [
  {
    id: "core-logic",
    label: "Core logic",
    description: "Main application behavior, state, control flow, and business logic.",
    tone: "changed",
  },
  {
    id: "ui-ux",
    label: "UI & UX",
    description: "Components, layout, styling, interactions, and reviewer-facing copy.",
    tone: "changed",
  },
  {
    id: "data-contracts",
    label: "Data & contracts",
    description: "APIs, schemas, persistence, requests, shared types, and data flow.",
    tone: "changed",
  },
  {
    id: "tests-validation",
    label: "Tests & validation",
    description: "Tests, fixtures, assertions, and verification scaffolding.",
    tone: "changed",
  },
  {
    id: "tooling-config",
    label: "Tooling & config",
    description: "Build tooling, scripts, CI, environment, dependencies, and configuration.",
    tone: "changed",
  },
  {
    id: "other-changes",
    label: "Other changes",
    description: "Files that changed but do not fit a stronger review area.",
    tone: "changed",
  },
] as const;

const AI_TRIAGE_SELECTION_IDS = new Set<string>(
  AI_TRIAGE_SELECTION_DEFINITIONS.map((section) => section.id),
);

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

function isSelectionId(value: string): value is AiTriageSelectionId {
  return AI_TRIAGE_SELECTION_IDS.has(value);
}

export function buildAiTriageSnapshotKey(input: AiTriageSnapshotInput): string {
  const normalizedFiles = input.files
    .toSorted((left, right) => left.path.localeCompare(right.path))
    .map((file) =>
      [
        file.path,
        file.status,
        file.additions,
        file.deletions,
        file.commentCount,
        file.hasAnnotation ? "1" : "0",
        file.fallbackBucket,
        file.note?.trim() ?? "",
      ].join(":"),
    )
    .join("\n");
  const normalizedSnapshot = [
    input.prNumber,
    input.prTitle.trim(),
    input.prBody.trim(),
    input.author.trim(),
    normalizedFiles,
  ].join("\n---\n");

  return hashString(normalizedSnapshot);
}

export function buildAiTriagePrompt(input: AiTriageSnapshotInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const candidateFiles = input.files.filter((file) => file.fallbackBucket === "changed");
  const fileList = candidateFiles
    .map((file) =>
      [
        `- ${file.path}`,
        `status=${file.status}`,
        `+${file.additions}`,
        `-${file.deletions}`,
        `comments=${file.commentCount}`,
        `ci=${file.hasAnnotation ? "yes" : "no"}`,
        `bucket=${file.fallbackBucket}`,
        file.note ? `note=${file.note}` : null,
      ]
        .filter(Boolean)
        .join(" | "),
    )
    .join("\n");

  return {
    systemPrompt:
      'You organize pull request files for a reviewer. Return strict JSON only with the schema {"sections":[{"sectionId":"core-logic|ui-ux|data-contracts|tests-validation|tooling-config|other-changes","paths":["exact/path.ts"]}]}. Use only the allowed sectionIds. Assign every candidate file to exactly one sectionId. Do not invent labels, descriptions, or extra keys. Prefer "other-changes" only when none of the stronger buckets fit. Files already marked as needs-attention or low-risk are handled separately, so classify only the candidate files provided.',
    userPrompt: `PR: ${input.prTitle} #${input.prNumber}\nAuthor: ${input.author}\n\nDescription:\n${input.prBody}\n\nAvailable sections:\n${AI_TRIAGE_SELECTION_DEFINITIONS.map((section) => `- ${section.id}: ${section.label} — ${section.description}`).join("\n")}\n\nCandidate files to classify:\n${fileList}`,
  };
}

export function parseAiTriagePayload(raw: string): AiTriagePayload | null {
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

  if (!parsed) {
    return null;
  }

  if (typeof parsed !== "object" || !("sections" in parsed)) {
    return null;
  }

  const sectionsValue = (parsed as { sections?: unknown }).sections;
  if (!Array.isArray(sectionsValue)) {
    return null;
  }

  const sections = sectionsValue.reduce<AiTriagePayloadSection[]>((accumulator, section) => {
    if (!section || typeof section !== "object" || accumulator.length >= MAX_SECTION_COUNT) {
      return accumulator;
    }

    const sectionId = typeof section.sectionId === "string" ? section.sectionId.trim() : "";
    const paths = Array.isArray(section.paths)
      ? section.paths.filter((value: unknown): value is string => typeof value === "string")
      : [];
    const trimmedPaths: string[] = paths
      .map((value: string) => value.trim())
      .filter((value: string) => value.length > 0);
    const uniquePaths = [...new Set<string>(trimmedPaths)];

    if (!isSelectionId(sectionId) || uniquePaths.length === 0) {
      return accumulator;
    }

    accumulator.push({
      sectionId,
      paths: uniquePaths,
    });

    return accumulator;
  }, []);

  if (sections.length === 0) {
    return null;
  }

  return { sections };
}
