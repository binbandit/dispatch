import { parseDiff } from "@/renderer/lib/review/diff-parser";
import { analyzeSemanticDiff } from "@/renderer/lib/review/semantic-diff";
import { describe, expect, it } from "vitest";

describe("analyzeSemanticDiff", () => {
  it("flags pure rename with no content changes", () => {
    const file = {
      oldPath: "src/old-name.ts",
      newPath: "src/new-name.ts",
      status: "renamed" as const,
      hunks: [],
      additions: 0,
      deletions: 0,
    };
    const signals = analyzeSemanticDiff(file);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toEqual({
      kind: "pure-rename",
      from: "src/old-name.ts",
      to: "src/new-name.ts",
    });
  });

  it("flags whitespace-only changes", () => {
    const raw = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
-function foo() { return 1; }
+function foo() {   return 1;   }
 const bar = 2;
`;
    const files = parseDiff(raw);
    const signals = analyzeSemanticDiff(files[0]!);
    expect(signals.find((signal) => signal.kind === "whitespace-only")).toBeDefined();
  });

  it("detects a single-identifier rename across multiple lines", () => {
    const raw = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,6 +1,6 @@
-const oldName = 1;
-function use() { return oldName + oldName; }
+const newName = 1;
+function use() { return newName + newName; }
 const unrelated = 2;
`;
    const files = parseDiff(raw);
    const signals = analyzeSemanticDiff(files[0]!);
    const rename = signals.find((signal) => signal.kind === "identifier-rename");
    expect(rename).toMatchObject({
      kind: "identifier-rename",
      from: "oldName",
      to: "newName",
    });
  });

  it("returns no identifier rename when tokens differ between lines", () => {
    const raw = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
-const a = 1;
-const b = 2;
+const x = 1;
+const y = 2;
`;
    const files = parseDiff(raw);
    const signals = analyzeSemanticDiff(files[0]!);
    expect(signals.find((signal) => signal.kind === "identifier-rename")).toBeUndefined();
  });

  it("returns empty signals for an ordinary content change", () => {
    const raw = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
-const answer = 41;
+const answer = 42;
 const name = "foo";
`;
    const files = parseDiff(raw);
    const signals = analyzeSemanticDiff(files[0]!);
    expect(signals).toEqual([]);
  });
});
