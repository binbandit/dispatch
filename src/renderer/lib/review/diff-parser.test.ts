import { computeWordDiff, getDiffFilePath, parseDiff } from "@/renderer/lib/review/diff-parser";
import { describe, expect, it } from "vite-plus/test";

describe("parseDiff", () => {
  it("parses a simple modification", () => {
    const raw = `diff --git a/src/index.ts b/src/index.ts
index abc1234..def5678 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,5 +1,6 @@
 import { app } from "electron";
 
-const name = "old";
+const name = "new";
+const version = "1.0.0";
 
 app.whenReady();`;

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);

    const file = files[0]!;
    expect(file.oldPath).toBe("src/index.ts");
    expect(file.newPath).toBe("src/index.ts");
    expect(file.status).toBe("modified");
    expect(file.additions).toBe(2);
    expect(file.deletions).toBe(1);
    expect(file.hunks).toHaveLength(1);

    const hunk = file.hunks[0]!;
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldCount).toBe(5);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newCount).toBe(6);

    // Should have 2 context + 1 del + 2 add + 2 context = 7 lines
    const lineTypes = hunk.lines.map((l) => l.type);
    expect(lineTypes).toEqual(["context", "context", "del", "add", "add", "context", "context"]);
  });

  it("parses a new file", () => {
    const raw = `diff --git a/src/new-file.ts b/src/new-file.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/new-file.ts
@@ -0,0 +1,3 @@
+export function hello() {
+  return "world";
+}`;

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);

    const file = files[0]!;
    expect(file.oldPath).toBe("/dev/null");
    expect(file.newPath).toBe("src/new-file.ts");
    expect(file.status).toBe("added");
    expect(file.additions).toBe(3);
    expect(file.deletions).toBe(0);
  });

  it("parses a deleted file", () => {
    const raw = `diff --git a/src/old-file.ts b/src/old-file.ts
deleted file mode 100644
index abc1234..0000000
--- a/src/old-file.ts
+++ /dev/null
@@ -1,4 +0,0 @@
-export function deprecated() {
-  return "gone";
-}
-`;

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);

    const file = files[0]!;
    expect(file.oldPath).toBe("src/old-file.ts");
    expect(file.newPath).toBe("/dev/null");
    expect(file.status).toBe("deleted");
    expect(file.additions).toBe(0);
    expect(file.deletions).toBe(4);
  });

  it("parses a renamed file", () => {
    const raw = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 80%
rename from src/old-name.ts
rename to src/new-name.ts
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,3 +1,3 @@
 export function greet() {
-  return "hello";
+  return "hi";
 }`;

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);

    const file = files[0]!;
    expect(file.oldPath).toBe("src/old-name.ts");
    expect(file.newPath).toBe("src/new-name.ts");
    expect(file.status).toBe("renamed");
    expect(file.additions).toBe(1);
    expect(file.deletions).toBe(1);
  });

  it("parses multiple hunks in one file", () => {
    const raw = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,4 @@
-import { old } from "old";
+import { newer } from "newer";
 
 const config = {};
 
@@ -20,4 +20,5 @@
 function run() {
   console.log("running");
+  console.log("extra log");
 }`;

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);

    const file = files[0]!;
    expect(file.hunks).toHaveLength(2);

    const [hunk1, hunk2] = file.hunks;
    expect(hunk1!.oldStart).toBe(1);
    expect(hunk1!.oldCount).toBe(4);
    expect(hunk1!.newStart).toBe(1);
    expect(hunk1!.newCount).toBe(4);

    expect(hunk2!.oldStart).toBe(20);
    expect(hunk2!.oldCount).toBe(4);
    expect(hunk2!.newStart).toBe(20);
    expect(hunk2!.newCount).toBe(5);
  });

  it("parses multiple files in one diff", () => {
    const raw = `diff --git a/src/foo.ts b/src/foo.ts
index abc1234..def5678 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,3 @@
 export const foo = {
-  value: 1,
+  value: 2,
 };
diff --git a/src/bar.ts b/src/bar.ts
index 1234567..abcdefg 100644
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -1,2 +1,3 @@
 export const bar = true;
+export const baz = false;`;

    const files = parseDiff(raw);
    expect(files).toHaveLength(2);

    expect(files[0]!.oldPath).toBe("src/foo.ts");
    expect(files[0]!.newPath).toBe("src/foo.ts");
    expect(files[0]!.additions).toBe(1);
    expect(files[0]!.deletions).toBe(1);

    expect(files[1]!.oldPath).toBe("src/bar.ts");
    expect(files[1]!.newPath).toBe("src/bar.ts");
    expect(files[1]!.additions).toBe(1);
    expect(files[1]!.deletions).toBe(0);
  });

  it("handles empty diff", () => {
    expect(parseDiff("")).toEqual([]);
    expect(parseDiff("  \n  \n  ")).toEqual([]);
  });

  it("tracks line numbers correctly", () => {
    const raw = `diff --git a/src/math.ts b/src/math.ts
index abc1234..def5678 100644
--- a/src/math.ts
+++ b/src/math.ts
@@ -3,7 +3,8 @@
 function add(a: number, b: number) {
   return a + b;
 }
-function subtract(a: number, b: number) {
-  return a - b;
+function sub(a: number, b: number) {
+  const result = a - b;
+  return result;
 }`;

    const files = parseDiff(raw);
    const { lines } = files[0]!.hunks[0]!;

    // First context line: old=3, new=3
    expect(lines[0]).toMatchObject({
      type: "context",
      content: "function add(a: number, b: number) {",
      oldLineNumber: 3,
      newLineNumber: 3,
    });

    // Second context line: old=4, new=4
    expect(lines[1]).toMatchObject({
      type: "context",
      oldLineNumber: 4,
      newLineNumber: 4,
    });

    // Third context line: old=5, new=5
    expect(lines[2]).toMatchObject({
      type: "context",
      content: "}",
      oldLineNumber: 5,
      newLineNumber: 5,
    });

    // First del: old=6, new=null
    expect(lines[3]).toMatchObject({
      type: "del",
      content: "function subtract(a: number, b: number) {",
      oldLineNumber: 6,
      newLineNumber: null,
    });

    // Second del: old=7, new=null
    expect(lines[4]).toMatchObject({
      type: "del",
      content: "  return a - b;",
      oldLineNumber: 7,
      newLineNumber: null,
    });

    // First add: old=null, new=6
    expect(lines[5]).toMatchObject({
      type: "add",
      content: "function sub(a: number, b: number) {",
      oldLineNumber: null,
      newLineNumber: 6,
    });

    // Second add: old=null, new=7
    expect(lines[6]).toMatchObject({
      type: "add",
      content: "  const result = a - b;",
      oldLineNumber: null,
      newLineNumber: 7,
    });

    // Third add: old=null, new=8
    expect(lines[7]).toMatchObject({
      type: "add",
      content: "  return result;",
      oldLineNumber: null,
      newLineNumber: 8,
    });

    // Final context: old=8, new=9
    expect(lines[8]).toMatchObject({
      type: "context",
      content: "}",
      oldLineNumber: 8,
      newLineNumber: 9,
    });
  });

  it("counts additions and deletions", () => {
    const raw = `diff --git a/src/config.ts b/src/config.ts
index abc1234..def5678 100644
--- a/src/config.ts
+++ b/src/config.ts
@@ -1,6 +1,8 @@
 const config = {
-  port: 3000,
-  host: "localhost",
+  port: 8080,
+  host: "0.0.0.0",
+  debug: true,
+  verbose: false,
 };
 
 export default config;`;

    const files = parseDiff(raw);
    const file = files[0]!;
    expect(file.additions).toBe(4);
    expect(file.deletions).toBe(2);
  });

  it("skips binary files", () => {
    const raw = `diff --git a/image.png b/image.png
index abc1234..def5678 100644
Binary files a/image.png and b/image.png differ`;

    const files = parseDiff(raw);
    expect(files).toHaveLength(0);
  });

  it("handles hunk headers without counts", () => {
    // When count is 1, git may omit it: @@ -1 +1 @@
    const raw = `diff --git a/src/single.ts b/src/single.ts
index abc1234..def5678 100644
--- a/src/single.ts
+++ b/src/single.ts
@@ -1 +1 @@
-const x = 1;
+const x = 2;`;

    const files = parseDiff(raw);
    const hunk = files[0]!.hunks[0]!;
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldCount).toBe(1);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newCount).toBe(1);
  });
});

describe("getDiffFilePath", () => {
  it("prefers the new path for added files", () => {
    expect(getDiffFilePath({ oldPath: "/dev/null", newPath: "src/new-file.ts" })).toBe(
      "src/new-file.ts",
    );
  });

  it("prefers the old path for deleted files", () => {
    expect(getDiffFilePath({ oldPath: "src/old-file.ts", newPath: "/dev/null" })).toBe(
      "src/old-file.ts",
    );
  });

  it("prefers the new path when both paths exist", () => {
    expect(getDiffFilePath({ oldPath: "src/old-name.ts", newPath: "src/new-name.ts" })).toBe(
      "src/new-name.ts",
    );
  });
});

describe("computeWordDiff", () => {
  it("returns equal segments for identical lines", () => {
    const result = computeWordDiff("hello world", "hello world");
    expect(result.oldSegments).toEqual([{ text: "hello world", type: "equal" }]);
    expect(result.newSegments).toEqual([{ text: "hello world", type: "equal" }]);
  });

  it("handles empty old line", () => {
    const result = computeWordDiff("", "new content");
    expect(result.oldSegments).toEqual([]);
    expect(result.newSegments).toEqual([{ text: "new content", type: "change" }]);
  });

  it("handles empty new line", () => {
    const result = computeWordDiff("old content", "");
    expect(result.oldSegments).toEqual([{ text: "old content", type: "change" }]);
    expect(result.newSegments).toEqual([]);
  });

  it("handles both empty lines", () => {
    const result = computeWordDiff("", "");
    expect(result.oldSegments).toEqual([]);
    expect(result.newSegments).toEqual([]);
  });

  it("highlights changed middle section", () => {
    const result = computeWordDiff('  const name = "old";', '  const name = "new";');
    expect(result.oldSegments).toEqual([
      { text: '  const name = "', type: "equal" },
      { text: "old", type: "change" },
      { text: '";', type: "equal" },
    ]);
    expect(result.newSegments).toEqual([
      { text: '  const name = "', type: "equal" },
      { text: "new", type: "change" },
      { text: '";', type: "equal" },
    ]);
  });

  it("highlights changed prefix", () => {
    const result = computeWordDiff("const x = 1;", "let x = 1;");
    expect(result.oldSegments).toEqual([
      { text: "const", type: "change" },
      { text: " x = 1;", type: "equal" },
    ]);
    expect(result.newSegments).toEqual([
      { text: "let", type: "change" },
      { text: " x = 1;", type: "equal" },
    ]);
  });

  it("highlights changed suffix", () => {
    const result = computeWordDiff("return value;", "return value || null;");
    expect(result.oldSegments).toEqual([{ text: "return value;", type: "equal" }]);
    expect(result.newSegments).toEqual([
      { text: "return value", type: "equal" },
      { text: " || null", type: "change" },
      { text: ";", type: "equal" },
    ]);
  });

  it("handles completely different lines", () => {
    const result = computeWordDiff("foo", "bar");
    expect(result.oldSegments).toEqual([{ text: "foo", type: "change" }]);
    expect(result.newSegments).toEqual([{ text: "bar", type: "change" }]);
  });

  it("handles realistic code change", () => {
    const result = computeWordDiff("  return a - b;", "  const result = a - b;");
    expect(result.oldSegments).toEqual([
      { text: "  ", type: "equal" },
      { text: "return", type: "change" },
      { text: " a - b;", type: "equal" },
    ]);
    expect(result.newSegments).toEqual([
      { text: "  ", type: "equal" },
      { text: "const result =", type: "change" },
      { text: " a - b;", type: "equal" },
    ]);
  });

  it("keeps operators intact instead of matching partial punctuation", () => {
    const result = computeWordDiff("if (value === next) {", "if (value !== next) {");
    expect(result.oldSegments).toEqual([
      { text: "if (value ", type: "equal" },
      { text: "===", type: "change" },
      { text: " next) {", type: "equal" },
    ]);
    expect(result.newSegments).toEqual([
      { text: "if (value ", type: "equal" },
      { text: "!==", type: "change" },
      { text: " next) {", type: "equal" },
    ]);
  });

  it("treats optional chaining and nullish operators as semantic tokens", () => {
    const result = computeWordDiff(
      "const value = foo?.bar ?? fallback;",
      "const value = foo.bar ?? fallback;",
    );
    expect(result.oldSegments).toEqual([
      { text: "const value = foo", type: "equal" },
      { text: "?.", type: "change" },
      { text: "bar ?? fallback;", type: "equal" },
    ]);
    expect(result.newSegments).toEqual([
      { text: "const value = foo", type: "equal" },
      { text: ".", type: "change" },
      { text: "bar ?? fallback;", type: "equal" },
    ]);
  });
});

describe("inline word diff segments in parsed hunks", () => {
  it("attaches word-level segments to paired add and delete lines", () => {
    const raw = `diff --git a/src/counts.ts b/src/counts.ts
index abc1234..def5678 100644
--- a/src/counts.ts
+++ b/src/counts.ts
@@ -1,3 +1,3 @@
 export function totalCount(count: number) {
-  return oldCount + count;
+  return newCount + count;
 }`;

    const file = parseDiff(raw)[0]!;
    const removedLine = file.hunks[0]!.lines.find((line) => line.type === "del");
    const addedLine = file.hunks[0]!.lines.find((line) => line.type === "add");

    expect(removedLine?.segments).toEqual([
      { text: "  return ", type: "equal" },
      { text: "old", type: "change" },
      { text: "Count + count;", type: "equal" },
    ]);
    expect(addedLine?.segments).toEqual([
      { text: "  return ", type: "equal" },
      { text: "new", type: "change" },
      { text: "Count + count;", type: "equal" },
    ]);
  });

  it("pairs delete/add runs by similarity instead of raw position", () => {
    const raw = `diff --git a/src/review.ts b/src/review.ts
index abc1234..def5678 100644
--- a/src/review.ts
+++ b/src/review.ts
@@ -10,3 +10,4 @@
-const status = "draft";
-const count = items.length;
+const header = createHeader();
+const status = "published";
+const itemCount = items.length;
 console.log("done");`;

    const file = parseDiff(raw)[0]!;
    const changedLines = file.hunks[0]!.lines;
    const deletedStatusLine = changedLines.find(
      (line) => line.content === 'const status = "draft";',
    );
    const deletedCountLine = changedLines.find(
      (line) => line.content === "const count = items.length;",
    );
    const insertedHeaderLine = changedLines.find(
      (line) => line.content === "const header = createHeader();",
    );
    const addedStatusLine = changedLines.find(
      (line) => line.content === 'const status = "published";',
    );
    const addedItemCountLine = changedLines.find(
      (line) => line.content === "const itemCount = items.length;",
    );

    expect(insertedHeaderLine?.pairId).toBeUndefined();
    expect(deletedStatusLine?.pairId).toBe(0);
    expect(addedStatusLine?.pairId).toBe(0);
    expect(deletedCountLine?.pairId).toBe(1);
    expect(addedItemCountLine?.pairId).toBe(1);
    expect(addedStatusLine?.segments).toEqual([
      { text: 'const status = "', type: "equal" },
      { text: "published", type: "change" },
      { text: '";', type: "equal" },
    ]);
    expect(addedItemCountLine?.segments).toEqual([
      { text: "const ", type: "equal" },
      { text: "itemCount", type: "change" },
      { text: " = items.length;", type: "equal" },
    ]);
  });

  it("keeps larger rewrite blocks aligned around inserted summary lines", () => {
    const raw = `diff --git a/src/status.ts b/src/status.ts
index abc1234..def5678 100644
--- a/src/status.ts
+++ b/src/status.ts
@@ -20,4 +20,5 @@
-const readyLine = renderLine("ready", readyCount);
-const blockedLine = renderLine("blocked", blockedCount);
-const failedLine = renderLine("failed", failedCount);
+const summaryLine = renderSummary(totalCount);
+const readyStatusLine = renderLine("ready", readyCount);
+const blockedStatusLine = renderLine("blocked", blockedCount);
+const failedStatusLine = renderLine("failed", failedCount);
 renderFooter();`;

    const file = parseDiff(raw)[0]!;
    const removedReadyLine = file.hunks[0]!.lines.find(
      (line) => line.content === 'const readyLine = renderLine("ready", readyCount);',
    );
    const removedBlockedLine = file.hunks[0]!.lines.find(
      (line) => line.content === 'const blockedLine = renderLine("blocked", blockedCount);',
    );
    const removedFailedLine = file.hunks[0]!.lines.find(
      (line) => line.content === 'const failedLine = renderLine("failed", failedCount);',
    );
    const insertedSummaryLine = file.hunks[0]!.lines.find(
      (line) => line.content === "const summaryLine = renderSummary(totalCount);",
    );
    const addedReadyLine = file.hunks[0]!.lines.find(
      (line) => line.content === 'const readyStatusLine = renderLine("ready", readyCount);',
    );
    const addedBlockedLine = file.hunks[0]!.lines.find(
      (line) => line.content === 'const blockedStatusLine = renderLine("blocked", blockedCount);',
    );
    const addedFailedLine = file.hunks[0]!.lines.find(
      (line) => line.content === 'const failedStatusLine = renderLine("failed", failedCount);',
    );

    expect(insertedSummaryLine?.pairId).toBeUndefined();
    expect(removedReadyLine?.pairId).toBe(0);
    expect(addedReadyLine?.pairId).toBe(0);
    expect(removedBlockedLine?.pairId).toBe(1);
    expect(addedBlockedLine?.pairId).toBe(1);
    expect(removedFailedLine?.pairId).toBe(2);
    expect(addedFailedLine?.pairId).toBe(2);
  });
});
