import "@testing-library/jest-dom/vitest";
import type { TriageSection } from "@/renderer/lib/review/triage-classifier";

import { TriageView } from "@/renderer/components/review/diff/triage-view";
import { parseDiff } from "@/renderer/lib/review/diff-parser";
import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

const TRIAGE_DIFF = `diff --git a/src/alpha.ts b/src/alpha.ts
index 1111111..2222222 100644
--- a/src/alpha.ts
+++ b/src/alpha.ts
@@ -1 +1 @@
-export const alpha = "old";
+export const alpha = "new";
diff --git a/src/beta.ts b/src/beta.ts
index 3333333..4444444 100644
--- a/src/beta.ts
+++ b/src/beta.ts
@@ -1 +1 @@
-export const beta = "old";
+export const beta = "new";
`;

describe("TriageView", () => {
  it("acts as a keyboard focus target and can select the next file with arrow keys", () => {
    const files = parseDiff(TRIAGE_DIFF);
    const onSelectFile = vi.fn();
    const sections: TriageSection[] = [
      {
        id: "changed",
        label: "Changed",
        tone: "changed",
        files: [
          { file: files[0]!, fileIndex: 0 },
          { file: files[1]!, fileIndex: 1 },
        ],
      },
    ];

    const { container } = render(
      <TriageView
        sections={sections}
        currentFileIndex={0}
        onSelectFile={onSelectFile}
        viewedFiles={new Set()}
        commentCounts={new Map()}
      />,
    );

    const focusTarget = container.querySelector<HTMLElement>(
      '[data-review-focus-target="file-tree"]',
    );

    expect(focusTarget).not.toBeNull();

    act(() => {
      focusTarget?.focus();
    });
    fireEvent.keyDown(focusTarget!, { key: "ArrowDown" });
    fireEvent.keyDown(focusTarget!, { key: "Enter" });

    expect(onSelectFile).toHaveBeenCalledWith(1);
  });
});
