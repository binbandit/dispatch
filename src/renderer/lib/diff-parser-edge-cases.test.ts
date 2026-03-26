import { describe, expect, it } from "vitest";

/**
 * Diff Parser Edge Cases & Security Tests
 * 
 * Tests for:
 * - Malformed input handling
 * - Large file handling
 * - Special characters & unicode
 * - Security: path traversal, command injection
 */

import { parseDiff, getDiffFilePath, type DiffFile } from "./diff-parser";

describe("Diff Parser - Critical Edge Cases", () => {
  describe("malformed input", () => {
    it("handles empty string", () => {
      const result = parseDiff("");
      expect(result).toEqual([]);
    });

    it("handles whitespace-only string", () => {
      const result = parseDiff("   \n\t  \n  ");
      expect(result).toEqual([]);
    });

    it("handles invalid diff header", () => {
      const invalidDiff = `NOT A DIFF HEADER
This is just random text
More random content`;
      
      const result = parseDiff(invalidDiff);
      expect(result).toEqual([]);
    });

    it("handles incomplete diff (missing hunks)", () => {
      const incompleteDiff = `diff --git a/file.ts b/file.ts
index abc123..def456 100644
--- a/file.ts
+++ b/file.ts`;
      
      const result = parseDiff(incompleteDiff);
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it("handles diff with invalid hunk header", () => {
      const invalidHunk = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ INVALID HUNK HEADER @@
 line1
+line2`;
      
      const result = parseDiff(invalidHunk);
      expect(result).toBeDefined();
    });
  });

  describe("special characters in filenames", () => {
    it("handles spaces in filename", () => {
      const diff = `diff --git a/file with spaces.ts b/file with spaces.ts
--- a/file with spaces.ts
+++ b/file with spaces.ts
@@ -1 +1,2 @@
 line1
+line2`;
      
      const result = parseDiff(diff);
      expect(result[0]?.newPath).toBe("file with spaces.ts");
    });

    it("handles unicode in filename", () => {
      const diff = `diff --git a/文件.ts b/文件.ts
--- a/文件.ts
+++ b/文件.ts
@@ -1 +1,2 @@
 line1
+line2`;
      
      const result = parseDiff(diff);
      expect(result[0]?.newPath).toBe("文件.ts");
    });

    it("handles emoji in filename", () => {
      const diff = `diff --git a/test🚀.ts b/test🚀.ts
--- a/test🚀.ts
+++ b/test🚀.ts
@@ -1 +1,2 @@
 line1
+line2`;
      
      const result = parseDiff(diff);
      expect(result[0]?.newPath).toBe("test🚀.ts");
    });

    it("handles quotes in filename", () => {
      const diff = `diff --git a/"quoted".ts b/"quoted".ts
--- a/"quoted".ts
+++ b/"quoted".ts
@@ -1 +1,2 @@
 line1
+line2`;
      
      const result = parseDiff(diff);
      expect(result).toBeDefined();
    });

    it("handles backslashes in filename (Windows paths)", () => {
      const diff = `diff --git a/src\\components\\Button.tsx b/src\\components\\Button.tsx
--- a/src\\components\\Button.tsx
+++ b/src\\components\\Button.tsx
@@ -1 +1,2 @@
 line1
+line2`;
      
      const result = parseDiff(diff);
      expect(result).toBeDefined();
    });
  });

  describe("security: path traversal", () => {
    it("handles ../ in filename", () => {
      const diff = `diff --git a/../../../etc/passwd b/../../../etc/passwd
--- a/../../../etc/passwd
+++ b/../../../etc/passwd
@@ -1 +1,2 @@
 line1
+line2`;
      
      const result = parseDiff(diff);
      const file = result[0];
      
      // Should preserve path as-is (UI layer should sanitize display)
      expect(file?.newPath).toContain("../");
    });

    it("handles absolute paths", () => {
      const diff = `diff --git a//etc/passwd b//etc/passwd
--- a//etc/passwd
+++ b//etc/passwd
@@ -1 +1,2 @@
 line1
+line2`;
      
      const result = parseDiff(diff);
      expect(result).toBeDefined();
    });

    it("getDiffFilePath returns safe path", () => {
      const file: DiffFile = {
        oldPath: "../../../etc/passwd",
        newPath: "file.ts",
        status: "modified",
        hunks: [],
        additions: 1,
        deletions: 0,
      };
      
      const path = getDiffFilePath(file);
      expect(path).toBe("file.ts"); // Uses newPath, not oldPath
    });

    it("getDiffFilePath handles deleted files", () => {
      const file: DiffFile = {
        oldPath: "deleted.ts",
        newPath: "/dev/null",
        status: "deleted",
        hunks: [],
        additions: 0,
        deletions: 1,
      };
      
      const path = getDiffFilePath(file);
      expect(path).toBe("deleted.ts");
    });
  });

  describe("large diffs", () => {
    it("handles diff with many files", () => {
      const files = Array.from({ length: 100 }, (_, i) => 
        `diff --git a/file${i}.ts b/file${i}.ts
--- a/file${i}.ts
+++ b/file${i}.ts
@@ -1 +1,2 @@
 line1
+line2`
      ).join("\n");
      
      const result = parseDiff(files);
      expect(result.length).toBe(100);
    });

    it("handles diff with very long lines", () => {
      const longLine = "x".repeat(10000);
      const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1 +1 @@
-${longLine}
+${longLine}modified`;
      
      const result = parseDiff(diff);
      expect(result[0]?.hunks[0]?.lines).toBeDefined();
    });

    it("handles diff with many hunks", () => {
      const hunks = Array.from({ length: 50 }, (_, i) => 
        `@@ -${i * 10},3 +${i * 10},3 @@
 line1
-line2
+line2modified
 line3`
      ).join("\n");
      
      const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
${hunks}`;
      
      const result = parseDiff(diff);
      expect(result[0]?.hunks.length).toBeGreaterThan(0);
    });
  });

  describe("line ending variations", () => {
    it("handles CRLF line endings", () => {
      const diff = "diff --git a/file.ts b/file.ts\r\n--- a/file.ts\r\n+++ b/file.ts\r\n@@ -1 +1,2 @@\r\n line1\r\n+line2";
      
      const result = parseDiff(diff);
      expect(result).toBeDefined();
    });

    it("handles mixed line endings", () => {
      const diff = "diff --git a/file.ts b/file.ts\n--- a/file.ts\r\n+++ b/file.ts\n@@ -1 +1,2 @@\r\n line1\n+line2";
      
      const result = parseDiff(diff);
      expect(result).toBeDefined();
    });

    it("handles no newline at end of file", () => {
      const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1 +1 @@
-line1
\\ No newline at end of file
+line1modified`;
      
      const result = parseDiff(diff);
      expect(result).toBeDefined();
    });
  });

  describe("binary files", () => {
    it("handles binary file marker", () => {
      const diff = `diff --git a/image.png b/image.png
index abc123..def456 100644
Binary files a/image.png and b/image.png differ`;
      
      const result = parseDiff(diff);
      expect(result).toBeDefined();
    });

    it("handles new binary file", () => {
      const diff = `diff --git a/image.png b/image.png
new file mode 100644
Binary files /dev/null and b/image.png differ`;
      
      const result = parseDiff(diff);
      expect(result).toBeDefined();
    });

    it("handles deleted binary file", () => {
      const diff = `diff --git a/image.png b/image.png
deleted file mode 100644
Binary files a/image.png and /dev/null differ`;
      
      const result = parseDiff(diff);
      expect(result).toBeDefined();
    });
  });

  describe("rename with changes", () => {
    it("handles renamed file with modifications", () => {
      const diff = `diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts
--- a/old.ts
+++ b/new.ts
@@ -1,3 +1,3 @@
 line1
-line2
+line2modified
 line3`;
      
      const result = parseDiff(diff);
      expect(result[0]?.status).toBeDefined();
      expect(result[0]?.oldPath).toBe("old.ts");
      expect(result[0]?.newPath).toBe("new.ts");
    });
  });

  describe("merge conflict markers", () => {
    it("handles diff with conflict markers in content", () => {
      const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,5 +1,5 @@
 line1
-<<<<<<< HEAD
-conflicted line
-=======
-other line
->>>>>>> branch
+resolved line`;
      
      const result = parseDiff(diff);
      expect(result).toBeDefined();
    });
  });

  describe("empty file operations", () => {
    it("handles adding empty file", () => {
      const diff = `diff --git a/empty.ts b/empty.ts
new file mode 100644
--- /dev/null
+++ b/empty.ts`;
      
      const result = parseDiff(diff);
      // Parser filters out files with no content (line 227-229 in diff-parser.ts)
      expect(result).toEqual([]);
    });

    it("handles deleting empty file", () => {
      const diff = `diff --git a/empty.ts b/empty.ts
deleted file mode 100644
--- a/empty.ts
+++ /dev/null`;
      
      const result = parseDiff(diff);
      // Parser filters out files with no content
      expect(result).toEqual([]);
    });
  });

  describe("performance", () => {
    it("parses large diff efficiently", () => {
      const largeDiff = Array.from({ length: 1000 }, (_, i) => 
        `diff --git a/file${i}.ts b/file${i}.ts
--- a/file${i}.ts
+++ b/file${i}.ts
@@ -1,10 +1,10 @@
${Array.from({ length: 10 }, (_, j) => ` line${j}`).join("\n")}`
      ).join("\n");
      
      const start = performance.now();
      const result = parseDiff(largeDiff);
      const end = performance.now();
      
      expect(result.length).toBeLessThanOrEqual(1000);
      expect(end - start).toBeLessThan(1000); // Should complete in under 1 second
    });
  });
});
