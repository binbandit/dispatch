/**
 * AI Code Review Suggestions — types and utilities.
 *
 * Provides the data model for AI-generated review suggestions,
 * the prompt builder for structured JSON output, and a robust
 * response parser with line number validation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AiSuggestionSeverity = "critical" | "warning" | "suggestion";

export interface AiSuggestion {
  /** Client-generated unique ID. */
  id: string;
  /** File path (matches DiffFile.newPath). */
  path: string;
  /** NEW-side line number where the suggestion anchors. */
  line: number;
  /** Severity classification from the AI. */
  severity: AiSuggestionSeverity;
  /** One-line summary (≤10 words). */
  title: string;
  /** Full comment body (markdown, may include suggestion code blocks). */
  body: string;
  /** Current lifecycle status. */
  status: "pending" | "posted" | "dismissed";
}

// ---------------------------------------------------------------------------
// Severity styling (mirrors inline-comment.tsx parseSeverity colors)
// ---------------------------------------------------------------------------

export function getSeverityStyle(severity: AiSuggestionSeverity): {
  label: string;
  bg: string;
  color: string;
  border: string;
} {
  switch (severity) {
    case "critical":
      return {
        label: "Critical",
        bg: "var(--danger-muted)",
        color: "var(--danger)",
        border: "var(--danger)",
      };
    case "warning":
      return {
        label: "Warning",
        bg: "var(--warning-muted)",
        color: "var(--warning)",
        border: "var(--warning)",
      };
    case "suggestion":
      return {
        label: "Suggestion",
        bg: "var(--bg-raised)",
        color: "var(--primary)",
        border: "var(--primary)",
      };
  }
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a senior code reviewer. Analyze the following diff and suggest review comments that a human reviewer would find genuinely helpful.

Focus on:
- Bugs, logic errors, or security issues (severity: "critical")
- Missing error handling, performance issues, design improvements (severity: "warning")
- Minor improvements or better patterns (severity: "suggestion")

Rules:
- Return AT MOST 5 suggestions per file. Fewer is better.
- Skip trivial formatting issues, style preferences, and obvious changes.
- Each suggestion must reference a specific NEW-side line number from the diff.
- Return ONLY a JSON array. No markdown fences, no explanation outside the array.
- Return an empty array [] if the code looks good.

JSON schema for each element:
{ "line": number, "severity": "critical"|"warning"|"suggestion", "title": string, "body": string }

The "body" field is the full review comment in GitHub-flavored markdown.
If suggesting a code replacement, use a \`\`\`suggestion code block.`;

export function buildSuggestionPrompt(
  prTitle: string,
  prBody: string,
  filePath: string,
  fileDiff: string,
): Array<{ role: "system" | "user"; content: string }> {
  const description = prBody.length > 500 ? `${prBody.slice(0, 500)}…` : prBody;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `PR: ${prTitle}\nDescription: ${description}\n\nFile: ${filePath}\n\nDiff:\n${fileDiff}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

const VALID_SEVERITIES = new Set<AiSuggestionSeverity>(["critical", "warning", "suggestion"]);

/**
 * Parse the AI response into validated suggestions.
 * Strips markdown fences, validates each element individually,
 * and drops entries with invalid line numbers.
 */
export function parseSuggestionsResponse(
  raw: string,
  filePath: string,
  validLines: Set<number>,
): AiSuggestion[] {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    const firstNewline = cleaned.indexOf("\n");
    cleaned = cleaned.slice(firstNewline + 1);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, cleaned.lastIndexOf("```"));
  }
  cleaned = cleaned.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const results: AiSuggestion[] = [];

  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const { line, severity, title, body } = item as Record<string, unknown>;

    if (typeof line !== "number" || !Number.isInteger(line)) {
      continue;
    }
    if (typeof severity !== "string" || !VALID_SEVERITIES.has(severity as AiSuggestionSeverity)) {
      continue;
    }
    if (typeof title !== "string" || title.length === 0) {
      continue;
    }
    if (typeof body !== "string" || body.length === 0) {
      continue;
    }

    if (!validLines.has(line)) {
      continue;
    }

    results.push({
      id: crypto.randomUUID(),
      path: filePath,
      line,
      severity: severity as AiSuggestionSeverity,
      title,
      body,
      status: "pending",
    });
  }

  return results.slice(0, 5);
}

/**
 * Extract the diff text for a single file from the full unified diff.
 */
export function extractFileDiff(fullDiff: string, filePath: string): string | null {
  const lines = fullDiff.split("\n");
  let capturing = false;
  const result: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      if (capturing) {
        break; // End of our file's diff
      }
      if (line.includes(`b/${filePath}`)) {
        capturing = true;
      }
    }
    if (capturing) {
      result.push(line);
    }
  }

  return result.length > 0 ? result.join("\n") : null;
}

/**
 * Collect all valid NEW-side line numbers from a parsed diff file's hunks.
 */
export function collectValidLines(
  hunks: Array<{ lines: Array<{ newLineNumber: number | null }> }>,
): Set<number> {
  const valid = new Set<number>();
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.newLineNumber !== null) {
        valid.add(line.newLineNumber);
      }
    }
  }
  return valid;
}
