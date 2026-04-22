import {
  buildFullFileRows,
  buildRows,
  type CommentRange,
} from "@/renderer/components/review/diff/diff-row-builder";
import { getSuggestionTextForRange } from "@/renderer/lib/review/comment-suggestions";
import { parseDiff } from "@/renderer/lib/review/diff-parser";
import { describe, expect, it } from "vitest";

const MULTI_LINE_DIFF = `diff --git a/src/example.ts b/src/example.ts
index abc1234..def5678 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,4 +1,4 @@
 export function alpha() {
-  return "old alpha";
+  const nextValue = "new alpha";
+  return nextValue;
 }`;

const FULL_FILE_DIFF = `diff --git a/src/context.ts b/src/context.ts
index abc1234..def5678 100644
--- a/src/context.ts
+++ b/src/context.ts
@@ -2,3 +2,3 @@
 export function alpha() {
-  return "old alpha";
+  return "new alpha";
 }`;

const FULL_FILE_CONTENT = `const before = true;
export function alpha() {
  return "new alpha";
}
const after = true;`;

describe("getSuggestionTextForRange", () => {
  it("extracts the selected right-side diff lines for inline suggestions", () => {
    const file = parseDiff(MULTI_LINE_DIFF)[0]!;
    const rows = buildRows({
      file,
      comments: new Map(),
      annotations: new Map(),
      composerRange: null,
    });
    const range: CommentRange = { startLine: 2, endLine: 3, side: "RIGHT" };

    expect(getSuggestionTextForRange(rows, range)).toBe(
      '  const nextValue = "new alpha";\n  return nextValue;',
    );
  });

  it("returns null for left-side selections", () => {
    const file = parseDiff(MULTI_LINE_DIFF)[0]!;
    const rows = buildRows({
      file,
      comments: new Map(),
      annotations: new Map(),
      composerRange: null,
    });

    expect(getSuggestionTextForRange(rows, { startLine: 2, endLine: 2, side: "LEFT" })).toBeNull();
  });

  it("extracts unchanged surrounding lines in full-file mode", () => {
    const file = parseDiff(FULL_FILE_DIFF)[0]!;
    const rows = buildFullFileRows({
      file,
      fullFileContent: FULL_FILE_CONTENT,
      comments: new Map(),
      annotations: new Map(),
      composerRange: null,
    })!;
    const range: CommentRange = { startLine: 4, endLine: 5, side: "RIGHT" };

    expect(getSuggestionTextForRange(rows, range)).toBe("}\nconst after = true;");
  });
});
