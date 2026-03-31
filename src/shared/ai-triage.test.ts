import { describe, expect, it } from "vitest";

import { buildAiTriageSnapshotKey, parseAiTriagePayload } from "./ai-triage";

const BASE_INPUT = {
  prNumber: 42,
  prTitle: "Improve review triage",
  prBody: "Groups files more intelligently.",
  author: "brayden",
  files: [
    {
      path: "src/review-sidebar.tsx",
      status: "modified" as const,
      additions: 22,
      deletions: 7,
      commentCount: 1,
      hasAnnotation: false,
      fallbackBucket: "attention" as const,
      note: "Significant edits",
    },
    {
      path: "src/review-sidebar.test.tsx",
      status: "added" as const,
      additions: 15,
      deletions: 0,
      commentCount: 0,
      hasAnnotation: false,
      fallbackBucket: "lowRisk" as const,
    },
  ],
};

describe("buildAiTriageSnapshotKey", () => {
  it("stays stable when files reorder", () => {
    expect(
      buildAiTriageSnapshotKey({
        ...BASE_INPUT,
        files: BASE_INPUT.files.toReversed(),
      }),
    ).toBe(buildAiTriageSnapshotKey(BASE_INPUT));
  });

  it("changes when file review signals change", () => {
    expect(
      buildAiTriageSnapshotKey({
        ...BASE_INPUT,
        files: BASE_INPUT.files.map((file) =>
          file.path === "src/review-sidebar.tsx" ? { ...file, commentCount: 2 } : file,
        ),
      }),
    ).not.toBe(buildAiTriageSnapshotKey(BASE_INPUT));
  });
});

describe("parseAiTriagePayload", () => {
  it("parses strict JSON payloads", () => {
    expect(
      parseAiTriagePayload(
        JSON.stringify({
          sections: [
            {
              sectionId: "core-logic",
              paths: ["src/review-sidebar.tsx"],
            },
          ],
        }),
      ),
    ).toEqual({
      sections: [
        {
          sectionId: "core-logic",
          paths: ["src/review-sidebar.tsx"],
        },
      ],
    });
  });

  it("parses fenced JSON and deduplicates paths", () => {
    expect(
      parseAiTriagePayload(`\`\`\`json
{
  "sections": [
    {
      "sectionId": "ui-ux",
      "paths": ["src/a.ts", "src/a.ts", "src/b.ts"]
    }
  ]
}
\`\`\``),
    ).toEqual({
      sections: [
        {
          sectionId: "ui-ux",
          paths: ["src/a.ts", "src/b.ts"],
        },
      ],
    });
  });

  it("returns null for invalid payloads", () => {
    expect(parseAiTriagePayload("not json")).toBeNull();
    expect(
      parseAiTriagePayload(
        JSON.stringify({
          sections: [{ sectionId: "made-up", paths: ["src/a.ts"] }],
        }),
      ),
    ).toBeNull();
  });
});
