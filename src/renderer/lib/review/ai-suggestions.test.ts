import {
  appendAiReviewMarker,
  buildAiSuggestionsSnapshotKey,
  buildExistingCommentFingerprints,
  buildSuggestionPrompt,
  collectValidLines,
  extractFileDiff,
  getSeverityStyle,
  isSuggestionDuplicate,
  parseSuggestionsResponse,
} from "@/renderer/lib/review/ai-suggestions";
import { describe, expect, it } from "vite-plus/test";

describe("parseSuggestionsResponse", () => {
  it("dedupes repeated suggestions in the same response", () => {
    const parsed = parseSuggestionsResponse(
      JSON.stringify([
        {
          line: 14,
          severity: "warning",
          title: "Handle undefined state",
          body: "This can throw when the value is undefined.",
        },
        {
          line: 16,
          severity: "warning",
          title: "Handle undefined state",
          body: "This can throw when the value is undefined.",
        },
      ]),
      "src/review.ts",
      new Set([14, 16]),
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.line).toBe(14);
  });

  it("filters suggestions that already exist as review comments on the same file", () => {
    const parsed = parseSuggestionsResponse(
      JSON.stringify([
        {
          line: 22,
          severity: "critical",
          title: "Missing null guard",
          body: "Guard against a missing token before calling `.trim()`.",
        },
      ]),
      "src/auth.ts",
      new Set([22]),
      [
        {
          path: "src/auth.ts",
          line: 18,
          body: "Guard against a missing token before calling `.trim()`.",
        },
      ],
    );

    expect(parsed).toEqual([]);
  });
});

describe("appendAiReviewMarker", () => {
  it("adds a hidden fingerprint marker exactly once", () => {
    const marked = appendAiReviewMarker("src/auth.ts", "Guard against a missing token.");

    expect(marked).toMatch(/<!-- dispatch-ai-review:[0-9a-f]{8} -->/u);
    expect(appendAiReviewMarker("src/auth.ts", marked)).toBe(marked);
  });
});

describe("buildAiSuggestionsSnapshotKey", () => {
  it("changes when the diff changes", () => {
    expect(buildAiSuggestionsSnapshotKey(42, "diff --git a/a.ts b/a.ts\n+one")).not.toBe(
      buildAiSuggestionsSnapshotKey(42, "diff --git a/a.ts b/a.ts\n+two"),
    );
  });
});

describe("buildSuggestionPrompt", () => {
  it("includes changed-file and existing-comment context", () => {
    const prompt = buildSuggestionPrompt(
      "Tighten auth checks",
      "Prevents nil tokens from leaking through.",
      "src/auth.ts",
      "diff --git a/src/auth.ts b/src/auth.ts",
      [
        { path: "src/auth.ts", additions: 12, deletions: 3 },
        { path: "src/session.ts", additions: 4, deletions: 0 },
      ],
      [{ line: 22, body: "We already asked for a null guard here." }],
    );

    expect(prompt[1]?.content).toContain("Changed files in this PR:");
    expect(prompt[1]?.content).toContain("src/session.ts (+4, -0)");
    expect(prompt[1]?.content).toContain("Existing review comments on this file:");
    expect(prompt[1]?.content).toContain("line 22: We already asked for a null guard here.");
  });

  it("caps oversized changed-file manifests", () => {
    const prompt = buildSuggestionPrompt(
      "Tighten auth checks",
      "Prevents nil tokens from leaking through.",
      "src/auth.ts",
      "diff --git a/src/auth.ts b/src/auth.ts",
      Array.from({ length: 28 }, (_, index) => ({
        path: `src/file-${index + 1}.ts`,
        additions: 2,
        deletions: 1,
      })),
      [],
    );

    expect(prompt[1]?.content).toContain("… 3 more changed files");
  });
});

describe("getSeverityStyle", () => {
  it("returns critical style", () => {
    const style = getSeverityStyle("critical");
    expect(style.label).toBe("Critical");
    expect(style.color).toContain("danger");
  });

  it("returns warning style", () => {
    expect(getSeverityStyle("warning").label).toBe("Warning");
  });

  it("returns suggestion style", () => {
    expect(getSeverityStyle("suggestion").label).toBe("Suggestion");
  });
});

describe("extractFileDiff", () => {
  const fullDiff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,3 +1,3 @@",
    " line1",
    "-old",
    "+new",
    "diff --git a/src/b.ts b/src/b.ts",
    "--- a/src/b.ts",
    "+++ b/src/b.ts",
    "@@ -1,1 +1,1 @@",
    "-b-old",
    "+b-new",
  ].join("\n");

  it("extracts diff for a specific file", () => {
    const result = extractFileDiff(fullDiff, "src/a.ts");
    expect(result).toContain("+new");
    expect(result).not.toContain("+b-new");
  });

  it("returns null for non-existent file", () => {
    expect(extractFileDiff(fullDiff, "src/c.ts")).toBeNull();
  });
});

describe("collectValidLines", () => {
  it("collects non-null new line numbers", () => {
    const result = collectValidLines([
      { lines: [{ newLineNumber: 1 }, { newLineNumber: null }, { newLineNumber: 3 }] },
    ]);
    expect(result).toEqual(new Set([1, 3]));
  });

  it("returns empty set for empty hunks", () => {
    expect(collectValidLines([])).toEqual(new Set());
  });
});

describe("parseSuggestionsResponse — additional cases", () => {
  const validLines = new Set([1, 2, 3, 10]);

  it("strips markdown code fences", () => {
    const raw = "```json\n" + JSON.stringify([
      { line: 1, severity: "warning", title: "Perf", body: "Optimize" },
    ]) + "\n```";
    expect(parseSuggestionsResponse(raw, "f.ts", validLines)).toHaveLength(1);
  });

  it("parses JSON arrays wrapped with extra commentary", () => {
    const raw = [
      "Here is the result:",
      "```json",
      JSON.stringify([{ line: 1, severity: "warning", title: "Perf", body: "Optimize" }]),
      "```",
      "Done.",
    ].join("\n");

    expect(parseSuggestionsResponse(raw, "f.ts", validLines)).toHaveLength(1);
  });

  it("returns empty for invalid JSON", () => {
    expect(parseSuggestionsResponse("not json", "f.ts", validLines)).toEqual([]);
  });

  it("returns empty for non-array JSON", () => {
    expect(parseSuggestionsResponse('{"key": "val"}', "f.ts", validLines)).toEqual([]);
  });

  it("skips entries with invalid line numbers", () => {
    const raw = JSON.stringify([{ line: 999, severity: "warning", title: "T", body: "B" }]);
    expect(parseSuggestionsResponse(raw, "f.ts", validLines)).toEqual([]);
  });

  it("skips entries missing required fields", () => {
    const raw = JSON.stringify([
      { line: 1, severity: "warning" },
      { line: 1, title: "T", body: "B" },
    ]);
    expect(parseSuggestionsResponse(raw, "f.ts", validLines)).toEqual([]);
  });

  it("caps at 5 suggestions", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      line: 1, severity: "suggestion", title: `T${i}`, body: `B${i}`,
    }));
    expect(parseSuggestionsResponse(JSON.stringify(items), "f.ts", validLines)).toHaveLength(5);
  });
});

describe("buildExistingCommentFingerprints", () => {
  it("returns empty set for no comments", () => {
    expect(buildExistingCommentFingerprints([])).toEqual(new Set());
  });

  it("extracts marker fingerprint when present", () => {
    const body = "Comment\n\n<!-- dispatch-ai-review:abcd1234 -->";
    const fp = buildExistingCommentFingerprints([{ path: "a.ts", line: 1, body }]);
    expect(fp.has("abcd1234")).toBe(true);
  });
});

describe("isSuggestionDuplicate", () => {
  it("returns true when fingerprint matches", () => {
    const fp = buildExistingCommentFingerprints([{ path: "a.ts", line: 1, body: "Fix" }]);
    expect(isSuggestionDuplicate({ path: "a.ts", body: "Fix" }, fp)).toBe(true);
  });

  it("returns false for different body", () => {
    const fp = buildExistingCommentFingerprints([{ path: "a.ts", line: 1, body: "Fix" }]);
    expect(isSuggestionDuplicate({ path: "a.ts", body: "Other" }, fp)).toBe(false);
  });
});
