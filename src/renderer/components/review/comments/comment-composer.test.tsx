/* eslint-disable vitest/prefer-import-in-mock -- These local mocks keep the keyboard-flow test focused on the inline composer behavior. */
import "@testing-library/jest-dom/vitest";
import { CommentComposer } from "@/renderer/components/review/comments/comment-composer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/renderer/lib/app/workspace-context", () => ({
  useWorkspace: () => ({
    repoTarget: { cwd: "/tmp/dispatch", owner: "binbandit", repo: "dispatch" },
  }),
}));

vi.mock("@/renderer/hooks/preferences/use-preference", () => ({
  usePreference: () => "immediate",
}));

vi.mock("@/renderer/lib/review/pending-review-store", () => ({
  usePendingReviewActions: () => ({
    addComment: vi.fn(),
  }),
}));

vi.mock("@/renderer/lib/app/ipc", () => ({
  ipc: vi.fn(),
}));

vi.mock("@/renderer/components/review/comments/review-markdown-composer", () => ({
  ReviewMarkdownComposer: ({
    autoFocus,
    onChange,
    onKeyDown,
    placeholder,
    value,
  }: {
    autoFocus?: boolean;
    onChange: (value: string) => void;
    onKeyDown?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
    placeholder?: string;
    value: string;
  }) => (
    <textarea
      aria-label={placeholder}
      autoFocus={autoFocus}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
    />
  ),
}));

function renderWithQueryClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function CommentComposerHarness() {
  const [open, setOpen] = useState(false);

  return open ? (
    <CommentComposer
      prNumber={42}
      filePath="src/example.ts"
      line={12}
      side="RIGHT"
      onClose={() => setOpen(false)}
    />
  ) : (
    <button
      type="button"
      data-review-comment-trigger="true"
      data-review-comment-line="12"
      data-review-comment-side="RIGHT"
      onClick={() => setOpen(true)}
    >
      Open composer
    </button>
  );
}

describe("CommentComposer", () => {
  it("closes an empty composer on Escape and restores focus to the last trigger", async () => {
    const user = userEvent.setup();

    renderWithQueryClient(<CommentComposerHarness />);

    await user.click(screen.getByRole("button", { name: "Open composer" }));

    const textarea = screen.getByLabelText("Leave a comment…");
    expect(textarea).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByLabelText("Leave a comment…")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open composer" })).toHaveFocus();
    });
  });

  it("cancels the composer on Escape even when the draft has content", async () => {
    const user = userEvent.setup();

    renderWithQueryClient(<CommentComposerHarness />);

    await user.click(screen.getByRole("button", { name: "Open composer" }));

    const textarea = screen.getByLabelText("Leave a comment…");
    await user.type(textarea, "Needs a null check here.");
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByLabelText("Leave a comment…")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open composer" })).toHaveFocus();
    });
  });
});
