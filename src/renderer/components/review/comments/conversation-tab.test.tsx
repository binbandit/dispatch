/* eslint-disable vitest/prefer-import-in-mock -- These local component mocks use string paths to keep Vitest typing simple in this suite. */
import "@testing-library/jest-dom/vitest";
import type { toastManager } from "@/components/ui/toast";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import {
  ConversationTab,
  ContentEvent,
  PanelComposer,
} from "@/renderer/components/review/comments/conversation-tab";
import { ipc } from "@/renderer/lib/app/ipc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@/renderer/components/review/comments/review-markdown-composer", () => ({
  ReviewMarkdownComposer: ({
    value,
    onChange,
    onKeyDown,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    onKeyDown?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
    placeholder?: string;
  }) => (
    <textarea
      aria-label={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
    />
  ),
}));

vi.mock("@/renderer/lib/app/ipc", () => ({
  ipc: vi.fn(),
}));

const { useBotSettingsMock } = vi.hoisted(() => ({
  useBotSettingsMock: vi.fn(() => ({
    isBot: (login: string) => login.toLowerCase().includes("bot"),
    shouldAutoCollapseBot: () => false,
    hideBotChatInConversations: false,
  })),
}));

vi.mock("@/renderer/hooks/preferences/use-bot-settings", () => ({
  useBotSettings: useBotSettingsMock,
}));

vi.mock("@/renderer/hooks/review/use-minimized-comments", () => ({
  useMinimizedComments: () => ({
    isCommentMinimized: () => false,
    toggleMinimized: vi.fn(),
  }),
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

function renderWithQueryClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function renderPanelComposer() {
  return renderWithQueryClient(<PanelComposer prNumber={42} />);
}

describe("ContentEvent", () => {
  it("toggles minimization when the comment header is clicked", async () => {
    const user = userEvent.setup();
    const onToggleMinimized = vi.fn();

    renderWithQueryClient(
      <ContentEvent
        commentId="comment-1"
        databaseId={101}
        login="alice"
        action="commented"
        time={new Date("2026-04-01T10:00:00Z")}
        body="Looks good."
        repo="binbandit/dispatch"
        isBot={false}
        canEdit={false}
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

    renderWithQueryClient(
      <ContentEvent
        commentId="comment-1"
        databaseId={101}
        login="alice"
        action="commented"
        time={new Date("2026-04-01T10:00:00Z")}
        body="Looks good."
        filePath="src/renderer/components/conversation-tab.tsx"
        repo="binbandit/dispatch"
        isBot={false}
        canEdit={false}
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

  it("uses the database ID when saving an edited conversation comment", async () => {
    const user = userEvent.setup();

    vi.mocked(ipc).mockResolvedValue();

    renderWithQueryClient(
      <ContentEvent
        commentId="IC_kwDOexample"
        databaseId={456}
        login="alice"
        action="commented"
        time={new Date("2026-04-01T10:00:00Z")}
        body="Looks good."
        repo="binbandit/dispatch"
        isBot={false}
        canEdit
        autoCollapse={false}
        prNumber={42}
        onClick={vi.fn()}
        minimized={false}
        onToggleMinimized={vi.fn()}
        reactions={[]}
      />,
    );

    fireEvent.contextMenu(screen.getByText("Looks good."));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Edit comment…"));
    await user.type(screen.getByLabelText("Edit comment…"), "Updated body.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(ipc).toHaveBeenCalledWith("pr.editIssueComment", {
        cwd: "/tmp/dispatch",
        owner: "binbandit",
        repo: "dispatch",
        prNumber: 42,
        commentId: 456,
        body: "Updated body.",
      });
    });
  });
});

describe("ConversationTab", () => {
  it("hides bot-authored chat when the preference is enabled", () => {
    useBotSettingsMock.mockReturnValue({
      isBot: (login: string) => login.toLowerCase().includes("bot"),
      shouldAutoCollapseBot: () => false,
      hideBotChatInConversations: true,
    });

    renderWithQueryClient(
      <ConversationTab
        prNumber={42}
        reviews={[]}
        issueComments={[
          {
            nodeId: "comment-bot",
            databaseId: 101,
            body: "Automated update is ready.",
            author: { login: "deploy-bot" },
            createdAt: "2026-04-01T10:00:00Z",
          },
          {
            nodeId: "comment-human",
            databaseId: 102,
            body: "Please take another look.",
            author: { login: "alice" },
            createdAt: "2026-04-01T11:00:00Z",
          },
        ]}
        reviewThreads={[]}
        repo="binbandit/dispatch"
        onReviewClick={vi.fn()}
      />,
    );

    expect(screen.queryByText("Automated update is ready.")).not.toBeInTheDocument();
    expect(screen.getByText("Please take another look.")).toBeInTheDocument();
  });
});

describe("PanelComposer", () => {
  it("keeps the submit button visible while typing", async () => {
    const api = globalThis as typeof globalThis & {
      api: Record<string, unknown> & { onAiRewriteSelection?: () => () => void };
    };
    const originalOnAiRewriteSelection = api.api.onAiRewriteSelection;
    api.api.onAiRewriteSelection = vi.fn(() => () => {});
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

    api.api.onAiRewriteSelection = originalOnAiRewriteSelection;
  });
});
