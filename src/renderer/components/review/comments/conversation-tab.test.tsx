/* eslint-disable vitest/prefer-import-in-mock -- These local component mocks use string paths to keep Vitest typing simple in this suite. */
import "@testing-library/jest-dom/vitest";
import type { toastManager } from "@/components/ui/toast";

import {
  ContentEvent,
  PanelComposer,
} from "@/renderer/components/review/comments/conversation-tab";
import { ipc } from "@/renderer/lib/app/ipc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/renderer/lib/app/workspace-context", () => ({
  useWorkspace: () => ({
    cwd: "/tmp/dispatch",
    nwo: "binbandit/dispatch",
    repoTarget: { cwd: "/tmp/dispatch", owner: "binbandit", repo: "dispatch" },
    switchWorkspace: vi.fn(),
  }),
}));

vi.mock("@/renderer/components/shared/github-avatar", () => ({
  GitHubAvatar: ({ login }: { login: string }) => <div>{login} avatar</div>,
}));

vi.mock("@/renderer/components/shared/markdown-body", () => ({
  MarkdownBody: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock("@/renderer/components/review/comments/reaction-bar", () => ({
  ReactionBar: () => null,
}));

vi.mock("@/renderer/lib/app/ipc", () => ({
  ipc: vi.fn(),
}));

const { toastManagerMock } = vi.hoisted(() => ({
  toastManagerMock: {
    add: vi.fn(),
    close: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
    subscribe: vi.fn(),
  },
}));

vi.mock("@/components/ui/toast", () => ({
  toastManager: toastManagerMock as unknown as typeof toastManager,
}));

function renderPanelComposer() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <PanelComposer prNumber={42} />
    </QueryClientProvider>,
  );
}

describe("ContentEvent", () => {
  it("toggles minimization when the comment header is clicked", async () => {
    const user = userEvent.setup();
    const onToggleMinimized = vi.fn();

    render(
      <ContentEvent
        commentId="comment-1"
        login="alice"
        action="commented"
        time={new Date("2026-04-01T10:00:00Z")}
        body="Looks good."
        repo="binbandit/dispatch"
        isBot={false}
        autoCollapse={false}
        prNumber={42}
        onClick={vi.fn()}
        minimized={false}
        onToggleMinimized={onToggleMinimized}
        reactions={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /minimize comment from alice/i }));

    expect(onToggleMinimized.mock.calls).toHaveLength(1);
  });

  it("keeps the file path click target separate from the header toggle", async () => {
    const user = userEvent.setup();
    const onToggleMinimized = vi.fn();
    const onClick = vi.fn();

    render(
      <ContentEvent
        commentId="comment-1"
        login="alice"
        action="commented"
        time={new Date("2026-04-01T10:00:00Z")}
        body="Looks good."
        filePath="src/renderer/components/conversation-tab.tsx"
        repo="binbandit/dispatch"
        isBot={false}
        autoCollapse={false}
        prNumber={42}
        onClick={onClick}
        minimized={false}
        onToggleMinimized={onToggleMinimized}
        reactions={[]}
      />,
    );

    await user.click(screen.getByText("src/renderer/components/conversation-tab.tsx"));

    expect(onClick.mock.calls).toHaveLength(1);
    expect(onToggleMinimized).not.toHaveBeenCalled();
  });
});

describe("PanelComposer", () => {
  it("keeps the submit button visible while typing", async () => {
    vi.mocked(ipc).mockImplementation((method: string) => {
      if (method === "pr.issuesList" || method === "pr.contributors") {
        return Promise.resolve([]);
      }

      if (method === "pr.comment") {
        return Promise.resolve({});
      }

      return Promise.resolve([]);
    });

    const user = userEvent.setup();

    renderPanelComposer();

    const button = screen.getByRole("button", { name: "Comment" });
    expect(button).toBeVisible();
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText("Leave a comment…"), "This stays visible.");

    expect(screen.getByRole("button", { name: "Comment" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Comment" })).toBeEnabled();
  });
});
