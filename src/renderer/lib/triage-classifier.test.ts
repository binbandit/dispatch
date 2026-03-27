import type { DiffFile } from "./diff-parser";

import { describe, expect, it } from "vitest";

import { classifyFiles } from "./triage-classifier";

function createDiffFile(overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    oldPath: "src/file.ts",
    newPath: "src/file.ts",
    status: "modified",
    additions: 10,
    deletions: 5,
    hunks: [],
    ...overrides,
  };
}

describe("classifyFiles", () => {
  describe("attention group", () => {
    it("classifies files with comments as attention", () => {
      const files = [createDiffFile({ newPath: "src/app.ts" })];
      const commentCounts = new Map([["src/app.ts", 3]]);
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.attention).toHaveLength(1);
      expect(result.attention[0]?.file.newPath).toBe("src/app.ts");
      expect(result.changed).toHaveLength(0);
      expect(result.lowRisk).toHaveLength(0);
    });

    it("classifies files with CI annotations as attention", () => {
      const files = [createDiffFile({ newPath: "src/app.ts" })];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set(["src/app.ts"]);
      const viewedFiles = new Set<string>();

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.attention).toHaveLength(1);
      expect(result.changed).toHaveLength(0);
      expect(result.lowRisk).toHaveLength(0);
    });

    it("classifies files with both comments and annotations as attention", () => {
      const files = [createDiffFile({ newPath: "src/app.ts" })];
      const commentCounts = new Map([["src/app.ts", 2]]);
      const annotationPaths = new Set(["src/app.ts"]);
      const viewedFiles = new Set<string>();

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.attention).toHaveLength(1);
      expect(result.changed).toHaveLength(0);
      expect(result.lowRisk).toHaveLength(0);
    });

    it("prioritizes attention over viewed status", () => {
      const files = [createDiffFile({ newPath: "src/app.ts" })];
      const commentCounts = new Map([["src/app.ts", 1]]);
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set(["src/app.ts"]);

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.attention).toHaveLength(1);
      expect(result.lowRisk).toHaveLength(0);
    });
  });

  describe("low risk group", () => {
    it("classifies viewed files as low risk", () => {
      const files = [createDiffFile({ newPath: "src/app.ts" })];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set(["src/app.ts"]);

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.lowRisk).toHaveLength(1);
      expect(result.attention).toHaveLength(0);
      expect(result.changed).toHaveLength(0);
    });

    it("classifies test files as low risk", () => {
      const testFiles = [
        createDiffFile({ newPath: "src/app.test.ts" }),
        createDiffFile({ newPath: "src/utils.spec.js" }),
        createDiffFile({ newPath: "__tests__/integration.ts" }),
        createDiffFile({ newPath: "src/__snapshots__/comp.snap" }),
      ];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(testFiles, commentCounts, annotationPaths, viewedFiles);

      expect(result.lowRisk).toHaveLength(4);
      expect(result.attention).toHaveLength(0);
      expect(result.changed).toHaveLength(0);
    });

    it("classifies lockfiles as low risk", () => {
      const lockFiles = [
        createDiffFile({ newPath: "package-lock.json" }),
        createDiffFile({ newPath: "yarn.lock" }),
        createDiffFile({ newPath: "bun.lockb" }),
        createDiffFile({ newPath: "pnpm-lock.yaml" }),
      ];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(lockFiles, commentCounts, annotationPaths, viewedFiles);

      expect(result.lowRisk).toHaveLength(4);
    });

    it("classifies config files as low risk", () => {
      const configFiles = [
        createDiffFile({ newPath: "vite.config.ts" }),
        createDiffFile({ newPath: "prettier.config.js" }),
      ];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(configFiles, commentCounts, annotationPaths, viewedFiles);

      expect(result.lowRisk).toHaveLength(2);
    });

    it("classifies type definition files as low risk", () => {
      const files = [createDiffFile({ newPath: "src/types.d.ts" })];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.lowRisk).toHaveLength(1);
    });

    it("classifies generated files as low risk", () => {
      const files = [
        createDiffFile({ newPath: "src/schema.generated.ts" }),
        createDiffFile({ newPath: "dist/bundle.min.js" }),
      ];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.lowRisk).toHaveLength(2);
    });
  });

  describe("changed group", () => {
    it("classifies regular modified files as changed", () => {
      const files = [
        createDiffFile({ newPath: "src/app.ts" }),
        createDiffFile({ newPath: "src/utils.ts" }),
      ];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.changed).toHaveLength(2);
      expect(result.attention).toHaveLength(0);
      expect(result.lowRisk).toHaveLength(0);
    });

    it("excludes viewed files from changed", () => {
      const files = [
        createDiffFile({ newPath: "src/app.ts" }),
        createDiffFile({ newPath: "src/utils.ts" }),
      ];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set(["src/app.ts"]);

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.changed).toHaveLength(1);
      expect(result.changed[0]?.file.newPath).toBe("src/utils.ts");
      expect(result.lowRisk).toHaveLength(1);
    });
  });

  describe("file annotations", () => {
    it("annotates added files", () => {
      const files = [createDiffFile({ newPath: "src/new.ts", status: "added" })];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.changed[0]?.annotation).toBe("New file — ts module");
    });

    it("annotates deleted files", () => {
      const files = [createDiffFile({ oldPath: "src/old.ts", status: "deleted" })];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.changed[0]?.annotation).toBe("Removed");
    });

    it("annotates renamed files", () => {
      const files = [
        createDiffFile({ oldPath: "src/old.ts", newPath: "src/new.ts", status: "renamed" }),
      ];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.changed[0]?.annotation).toBe("Renamed");
    });

    it("annotates major changes (>100 lines)", () => {
      const files = [createDiffFile({ additions: 80, deletions: 30 })];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.changed[0]?.annotation).toBe("Major changes");
    });

    it("annotates significant edits (31-100 lines)", () => {
      const files = [createDiffFile({ additions: 20, deletions: 15 })];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.changed[0]?.annotation).toBe("Significant edits");
    });

    it("no annotation for small changes", () => {
      const files = [createDiffFile({ additions: 5, deletions: 3 })];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.changed[0]?.annotation).toBe("");
    });
  });

  describe("file indexes", () => {
    it("preserves file indexes in triage entries", () => {
      const files = [
        createDiffFile({ newPath: "src/a.ts" }),
        createDiffFile({ newPath: "src/b.ts" }),
        createDiffFile({ newPath: "src/c.ts" }),
      ];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.changed[0]?.fileIndex).toBe(0);
      expect(result.changed[1]?.fileIndex).toBe(1);
      expect(result.changed[2]?.fileIndex).toBe(2);
    });
  });

  describe("complex scenarios", () => {
    it("handles mixed file types correctly", () => {
      const files = [
        createDiffFile({ newPath: "src/app.ts" }), // Changed
        createDiffFile({ newPath: "src/utils.test.ts" }), // Low risk (test)
        createDiffFile({ newPath: "src/config.ts" }), // Attention (has comment)
        createDiffFile({ newPath: "package-lock.json" }), // Low risk (lockfile)
        createDiffFile({ newPath: "src/types.d.ts" }), // Low risk (type def)
      ];
      const commentCounts = new Map([["src/config.ts", 2]]);
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.attention).toHaveLength(1);
      expect(result.changed).toHaveLength(1);
      expect(result.lowRisk).toHaveLength(3);
    });

    it("handles empty inputs", () => {
      const files: DiffFile[] = [];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.attention).toHaveLength(0);
      expect(result.changed).toHaveLength(0);
      expect(result.lowRisk).toHaveLength(0);
    });

    it("handles files with no comments count (undefined)", () => {
      const files = [createDiffFile({ newPath: "src/app.ts" })];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.changed).toHaveLength(1);
    });
  });

  describe("edge cases", () => {
    it("handles files with no extension", () => {
      const files = [createDiffFile({ newPath: "Dockerfile" })];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.changed).toHaveLength(1);
    });

    it("handles deeply nested paths", () => {
      const files = [createDiffFile({ newPath: "src/deep/nested/path/file.ts" })];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.changed).toHaveLength(1);
    });

    it("handles zero additions and deletions", () => {
      const files = [createDiffFile({ additions: 0, deletions: 0 })];
      const commentCounts = new Map<string, number>();
      const annotationPaths = new Set<string>();
      const viewedFiles = new Set<string>();

      const result = classifyFiles(files, commentCounts, annotationPaths, viewedFiles);

      expect(result.changed[0]?.annotation).toBe("");
    });
  });
});
