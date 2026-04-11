import "@testing-library/jest-dom/vitest";
import type { AiSuggestion } from "@/renderer/lib/review/ai-suggestions";
import type { Highlighter } from "shiki";

import { DiffViewer } from "@/renderer/components/review/diff/diff-viewer";
import { parseDiff } from "@/renderer/lib/review/diff-parser";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock(import("@/renderer/components/review/diff/blame-popover"), () => ({
  BlameButton: ({ line }: { line: number }) => (
    <div data-testid={`blame-button-${line}`}>blame {line}</div>
  ),
}));

const MULTI_HUNK_DIFF = `diff --git a/src/example.ts b/src/example.ts
index abc1234..def5678 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,3 @@ section-alpha
 export function alpha() {
-  return "old alpha";
+  return "new alpha";
 }
@@ -10,3 +10,3 @@ section-beta
 export function beta() {
-  return "old beta";
+  return "new beta";
}`;

const DELETED_FILE_DIFF = `diff --git a/src/removed.ts b/src/removed.ts
deleted file mode 100644
index abc1234..0000000
--- a/src/removed.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const removed = true;
-console.log("gone");`;

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

const WORD_DIFF_RENDER_DIFF = `diff --git a/src/counts.ts b/src/counts.ts
index abc1234..def5678 100644
--- a/src/counts.ts
+++ b/src/counts.ts
@@ -1,3 +1,3 @@
 export function totalCount(count: number) {
-  return oldCount + count;
+  return newCount + count;
 }`;

const SHIFTED_PAIR_DIFF = `diff --git a/src/review.ts b/src/review.ts
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

describe("DiffViewer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders each hunk header once without extra synthetic header rows", () => {
    const file = parseDiff(MULTI_HUNK_DIFF)[0]!;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<DiffViewer file={file} />);

    expect(screen.getAllByText("@@ -1,3 +1,3 @@ section-alpha")).toHaveLength(1);
    expect(screen.getAllByText("@@ -10,3 +10,3 @@ section-beta")).toHaveLength(1);
    expect(screen.queryByText("section-alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("section-beta")).not.toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === '  return "new alpha";'),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === '  return "new beta";'),
    ).toBeInTheDocument();
    expect(
      consoleError.mock.calls.some(([message]) => String(message).includes("same key")),
    ).toBeFalsy();
  });

  it("renders blame actions for non-deleted diff lines", () => {
    const file = parseDiff(MULTI_HUNK_DIFF)[0]!;

    render(<DiffViewer file={file} />);

    expect(screen.getByTestId("blame-button-1")).toBeInTheDocument();
    expect(screen.getByTestId("blame-button-2")).toBeInTheDocument();
    expect(screen.getByTestId("blame-button-3")).toBeInTheDocument();
    expect(screen.getByTestId("blame-button-10")).toBeInTheDocument();
    expect(screen.getByTestId("blame-button-11")).toBeInTheDocument();
  });

  it("allows opening the comment composer on deleted lines", () => {
    const file = parseDiff(DELETED_FILE_DIFF)[0]!;
    const onCommentRange = vi.fn();

    render(
      <DiffViewer
        file={file}
        onCommentRange={onCommentRange}
      />,
    );

    fireEvent.click(screen.getByLabelText("Comment on line 1"));

    expect(onCommentRange).toHaveBeenCalledWith({
      startLine: 1,
      endLine: 1,
      side: "LEFT",
    });
  });

  it("allows commenting on unchanged surrounding lines in full-file mode", () => {
    const file = parseDiff(FULL_FILE_DIFF)[0]!;
    const onCommentRange = vi.fn();

    render(
      <DiffViewer
        file={file}
        diffMode="full-file"
        fullFileContent={FULL_FILE_CONTENT}
        onCommentRange={onCommentRange}
      />,
    );

    fireEvent.click(screen.getByLabelText("Comment on line 5"));

    expect(onCommentRange).toHaveBeenCalledWith({
      startLine: 5,
      endLine: 5,
      side: "RIGHT",
    });
  });

  it("hides inline comment affordances when review actions are disabled", () => {
    const file = parseDiff(DELETED_FILE_DIFF)[0]!;

    render(
      <DiffViewer
        file={file}
        reviewActionsEnabled={false}
      />,
    );

    expect(screen.queryByLabelText("Comment on line 1")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Comment on line 2")).not.toBeInTheDocument();
  });

  it("reserves bottom scroll clearance for overlay controls", () => {
    const file = parseDiff(MULTI_HUNK_DIFF)[0]!;
    const { container } = render(
      <DiffViewer
        file={file}
        bottomOverlayInset={96}
      />,
    );

    const scrollContainer = container.querySelector('[tabindex="-1"]');

    expect(scrollContainer).not.toBeNull();
    expect(scrollContainer).toHaveStyle("padding-bottom: 96px; scroll-padding-bottom: 96px;");
  });

  it("renders AI suggestion rows in split mode", () => {
    const file = parseDiff(MULTI_HUNK_DIFF)[0]!;
    const suggestions = new Map<string, AiSuggestion[]>([
      [
        "src/example.ts:2",
        [
          {
            id: "suggestion-1",
            path: "src/example.ts",
            line: 2,
            severity: "warning",
            title: "Handle the renamed return path",
            body: "Consider guarding the new branch before returning it.",
            status: "pending",
          },
        ],
      ],
    ]);

    render(
      <DiffViewer
        file={file}
        diffMode="split"
        aiSuggestions={suggestions}
        onPostSuggestion={vi.fn()}
        onDismissSuggestion={vi.fn()}
      />,
    );

    expect(screen.getByText("Handle the renamed return path")).toBeInTheDocument();
  });

  it("keeps word-level highlights when syntax tokens are present", () => {
    const file = parseDiff(WORD_DIFF_RENDER_DIFF)[0]!;
    const highlighter = {
      getLoadedLanguages: () => ["typescript"],
      codeToTokens: (content: string) => ({
        tokens: [[{ content, color: "rgb(16, 32, 48)" }]],
      }),
    } as unknown as Highlighter;

    render(
      <DiffViewer
        file={file}
        highlighter={highlighter}
        language="typescript"
      />,
    );

    const removedWord = screen.getByText("old");
    const addedWord = screen.getByText("new");

    expect(removedWord).toHaveClass("bg-diff-del-word");
    expect(addedWord).toHaveClass("bg-diff-add-word");
    expect(removedWord).toHaveStyle({ color: "rgb(16, 32, 48)" });
    expect(addedWord).toHaveStyle({ color: "rgb(16, 32, 48)" });
  });

  it("keeps split rows aligned when inserted lines shift an add/delete run", () => {
    const file = parseDiff(SHIFTED_PAIR_DIFF)[0]!;

    render(
      <DiffViewer
        file={file}
        diffMode="split"
      />,
    );

    const insertedHeaderRow = screen.getByText("const header = createHeader();").closest("tr");
    const statusRow = screen
      .getByText((_, element) => element?.textContent === 'const status = "published";')
      .closest("tr");
    const itemCountRow = screen
      .getByText((_, element) => element?.textContent === "const itemCount = items.length;")
      .closest("tr");

    expect(insertedHeaderRow?.textContent).not.toContain('const status = "draft";');
    expect(statusRow?.textContent).toContain('const status = "draft";');
    expect(statusRow?.textContent).toContain('const status = "published";');
    expect(itemCountRow?.textContent).toContain("const count = items.length;");
    expect(itemCountRow?.textContent).toContain("const itemCount = items.length;");
  });
});
