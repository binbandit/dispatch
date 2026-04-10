import "@testing-library/jest-dom/vitest";
import { FileTree } from "@/renderer/components/review/diff/file-tree";
import { parseDiff } from "@/renderer/lib/review/diff-parser";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const MULTI_FILE_DIFF = `diff --git a/src/nested/a.ts b/src/nested/a.ts
index 1111111..2222222 100644
--- a/src/nested/a.ts
+++ b/src/nested/a.ts
@@ -1 +1 @@
-export const alpha = "old";
+export const alpha = "new";
diff --git a/src/nested/b.ts b/src/nested/b.ts
index 3333333..4444444 100644
--- a/src/nested/b.ts
+++ b/src/nested/b.ts
@@ -1 +1 @@
-export const beta = "old";
+export const beta = "new";
diff --git a/README.md b/README.md
index 5555555..6666666 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-old readme
+new readme
`;

describe("FileTree", () => {
  it("shows a mixed folder checkbox and marks all descendants as viewed", () => {
    const files = parseDiff(MULTI_FILE_DIFF);
    const onSetFilesViewed = vi.fn();

    render(
      <FileTree
        files={files}
        currentFileIndex={0}
        onSelectFile={() => {}}
        viewedFiles={new Set(["src/nested/a.ts"])}
        onSetFilesViewed={onSetFilesViewed}
        nwo="acme/dispatch"
        prNumber={42}
      />,
    );

    const nestedFolderCheckbox = screen.getByRole("checkbox", {
      name: "Mark folder src/nested as viewed",
    });

    expect(nestedFolderCheckbox).toHaveAttribute("aria-checked", "mixed");

    fireEvent.click(nestedFolderCheckbox);

    expect(onSetFilesViewed).toHaveBeenCalledWith(["src/nested/a.ts", "src/nested/b.ts"], true);
  });

  it("marks a fully viewed folder as unviewed", () => {
    const files = parseDiff(MULTI_FILE_DIFF);
    const onSetFilesViewed = vi.fn();

    render(
      <FileTree
        files={files}
        currentFileIndex={0}
        onSelectFile={() => {}}
        viewedFiles={new Set(["src/nested/a.ts", "src/nested/b.ts"])}
        onSetFilesViewed={onSetFilesViewed}
        nwo="acme/dispatch"
        prNumber={42}
      />,
    );

    const nestedFolderCheckbox = screen.getByRole("checkbox", {
      name: "Mark folder src/nested as unviewed",
    });

    expect(nestedFolderCheckbox).toHaveAttribute("aria-checked", "true");

    fireEvent.click(nestedFolderCheckbox);

    expect(onSetFilesViewed).toHaveBeenCalledWith(["src/nested/a.ts", "src/nested/b.ts"], false);
  });

  it("hides reviewed toggles when viewed state is read-only", () => {
    const files = parseDiff(MULTI_FILE_DIFF);

    render(
      <FileTree
        files={files}
        currentFileIndex={0}
        onSelectFile={() => {}}
        viewedFiles={new Set(["src/nested/a.ts"])}
        nwo="acme/dispatch"
        prNumber={42}
      />,
    );

    expect(
      screen.queryByRole("checkbox", { name: "Mark folder src/nested as viewed" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Mark file src/nested/a.ts as unviewed" }),
    ).not.toBeInTheDocument();
  });
});
