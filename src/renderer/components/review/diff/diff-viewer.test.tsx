import "@testing-library/jest-dom/vitest";
import { DiffViewer } from "@/renderer/components/review/diff/diff-viewer";
import { parseDiff } from "@/renderer/lib/review/diff-parser";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
