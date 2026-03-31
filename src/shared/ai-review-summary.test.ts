import { describe, expect, it } from "vitest";

import {
  buildAiReviewSummarySnapshotKey,
  parseAiReviewConfidencePayload,
  parseAiReviewSummaryPayload,
} from "./ai-review-summary";

const BASE_INPUT = {
  prNumber: 42,
  prTitle: "Refactor PR summary cache",
  prBody: "Caches the generated AI summary.",
  author: "brayden",
  files: [
    { path: "src/a.ts", additions: 10, deletions: 2 },
    { path: "src/b.ts", additions: 4, deletions: 1 },
  ],
  diffSnippet: "line one\nline two",
};

describe("buildAiReviewSummarySnapshotKey", () => {
  it("is stable even if files are passed in a different order", () => {
    expect(
      buildAiReviewSummarySnapshotKey({
        ...BASE_INPUT,
        files: BASE_INPUT.files.toReversed(),
      }),
    ).toBe(buildAiReviewSummarySnapshotKey(BASE_INPUT));
  });

  it("changes when summary-relevant PR inputs change", () => {
    expect(
      buildAiReviewSummarySnapshotKey({
        ...BASE_INPUT,
        prBody: "Caches and invalidates the generated AI summary.",
      }),
    ).not.toBe(buildAiReviewSummarySnapshotKey(BASE_INPUT));
  });
});

describe("parseAiReviewSummaryPayload", () => {
  it("parses strict JSON payloads", () => {
    expect(
      parseAiReviewSummaryPayload(
        JSON.stringify({
          summary: "- Focus on the new cache invalidation path.",
        }),
      ),
    ).toEqual({
      summary: "- Focus on the new cache invalidation path.",
    });
  });

  it("parses fenced JSON payloads", () => {
    expect(
      parseAiReviewSummaryPayload(`\`\`\`json
{
  "summary": "- Verify the snapshot comparison."
}
\`\`\``),
    ).toEqual({
      summary: "- Verify the snapshot comparison.",
    });
  });

  it("rejects invalid payloads", () => {
    expect(parseAiReviewSummaryPayload("not json")).toBeNull();
    expect(
      parseAiReviewSummaryPayload(
        JSON.stringify({
          summary: "",
        }),
      ),
    ).toBeNull();
  });
});

describe("parseAiReviewConfidencePayload", () => {
  it("parses strict JSON confidence payloads", () => {
    expect(
      parseAiReviewConfidencePayload(
        JSON.stringify({
          confidenceScore: 78,
        }),
      ),
    ).toEqual({
      confidenceScore: 78,
    });
  });

  it("rejects invalid confidence payloads", () => {
    expect(parseAiReviewConfidencePayload("not json")).toBeNull();
    expect(
      parseAiReviewConfidencePayload(
        JSON.stringify({
          confidenceScore: 120,
        }),
      ),
    ).toBeNull();
  });
});
