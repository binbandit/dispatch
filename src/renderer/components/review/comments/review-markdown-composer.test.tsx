/* eslint-disable vitest/prefer-import-in-mock -- These local mocks keep the test wiring simple and explicit. */
import "@testing-library/jest-dom/vitest";
import { ReviewMarkdownComposer } from "@/renderer/components/review/comments/review-markdown-composer";
import { ipc } from "@/renderer/lib/app/ipc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/renderer/lib/app/workspace-context", () => ({
  useWorkspace: () => ({
    cwd: "/tmp/dispatch",
    nwo: "binbandit/dispatch",
    repoTarget: { cwd: "/tmp/dispatch", owner: "binbandit", repo: "dispatch" },
  }),
}));

vi.mock("@/renderer/lib/app/ipc", () => ({
  ipc: vi.fn(),
}));

vi.mock("@/renderer/hooks/ai/use-ai-task-config", () => ({
  useAiTaskConfig: (task: string) => ({
    task,
    selectedSlot: "small",
    selectedSlotSource: "default",
    slot: "small",
    provider: "codex",
    model: "gpt-5.4-mini",
    binaryPath: null,
    homePath: null,
    baseUrl: null,
    isConfigured: true,
    providerSource: "preference",
    modelSource: "preference",
    binaryPathSource: "none",
    homePathSource: "none",
    baseUrlSource: "none",
    providerEnvVar: null,
    modelEnvVar: null,
    binaryPathEnvVar: null,
    homePathEnvVar: null,
    baseUrlEnvVar: null,
  }),
}));

vi.mock("@/renderer/components/review/comments/suggestion-block", () => ({
  SuggestionBlock: () => null,
  parseSuggestions: () => ({ bodyParts: [], suggestions: [] }),
}));

vi.mock("@/renderer/components/shared/markdown-body", () => ({
  MarkdownBody: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock("@/renderer/components/shared/github-avatar", () => ({
  GitHubAvatar: ({ login }: { login: string }) => <div>{login}</div>,
}));

let rewriteSelectionListener: (() => void) | null = null;

const existingApi = (globalThis.api ?? {}) as typeof globalThis.api;

globalThis.api = {
  ...existingApi,
  invoke: existingApi.invoke ?? vi.fn(),
  setBadgeCount: existingApi.setBadgeCount ?? vi.fn(),
  onNavigate: existingApi.onNavigate ?? vi.fn(() => () => {}),
  onAnalyticsTrack: existingApi.onAnalyticsTrack ?? vi.fn(() => () => {}),
  onAiRewriteSelection: vi.fn((callback: () => void) => {
    rewriteSelectionListener = callback;
    return () => {
      rewriteSelectionListener = null;
    };
  }),
  onWindowStateChange: existingApi.onWindowStateChange ?? vi.fn(() => () => {}),
};

function ComposerHarness() {
  const [value, setValue] = useState("Please make this wording more direct.");

  return (
    <ReviewMarkdownComposer
      onChange={setValue}
      placeholder="Leave a comment…"
      prNumber={42}
      value={value}
    />
  );
}

function renderComposer() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ComposerHarness />
    </QueryClientProvider>,
  );
}

describe("ReviewMarkdownComposer", () => {
  it("ignores rewrite requests when no text is selected", () => {
    vi.mocked(ipc).mockImplementation((method: string) => {
      if (method === "pr.issuesList" || method === "pr.contributors") {
        return Promise.resolve([]);
      }

      return Promise.resolve("");
    });

    renderComposer();

    const textarea = screen.getByLabelText("Leave a comment…") as HTMLTextAreaElement;
    textarea.focus();
    void act(() => {
      rewriteSelectionListener?.();
    });

    expect(ipc).not.toHaveBeenCalledWith(
      "ai.complete",
      expect.objectContaining({ task: "commentRewrite" }),
    );
  });

  it("rewrites the selected text in place when the native menu action fires", async () => {
    vi.mocked(ipc).mockImplementation((method: string) => {
      if (method === "pr.issuesList" || method === "pr.contributors") {
        return Promise.resolve([]);
      }

      if (method === "ai.complete") {
        return Promise.resolve("make this wording clearer");
      }

      return Promise.resolve("");
    });

    const user = userEvent.setup();
    renderComposer();

    const textarea = screen.getByLabelText("Leave a comment…") as HTMLTextAreaElement;
    const start = "Please ".length;
    const end = "Please make this wording more direct.".length;

    await user.click(textarea);
    textarea.setSelectionRange(start, end);
    fireEvent.select(textarea);

    await act(() => {
      rewriteSelectionListener?.();
    });

    await waitFor(() => {
      expect(textarea.value).toBe("Please make this wording clearer");
    });

    expect(ipc).toHaveBeenCalledWith(
      "ai.complete",
      expect.objectContaining({
        task: "commentRewrite",
        maxTokens: 512,
      }),
    );
  });

  it("uses the last selected range if the live selection collapses before rewrite runs", async () => {
    vi.mocked(ipc).mockImplementation((method: string) => {
      if (method === "pr.issuesList" || method === "pr.contributors") {
        return Promise.resolve([]);
      }

      if (method === "ai.complete") {
        return Promise.resolve("make this wording clearer");
      }

      return Promise.resolve("");
    });

    const user = userEvent.setup();
    renderComposer();

    const textarea = screen.getByLabelText("Leave a comment…") as HTMLTextAreaElement;
    const start = "Please ".length;
    const end = "Please make this wording more direct.".length;

    await user.click(textarea);
    textarea.setSelectionRange(start, end);
    fireEvent.select(textarea);
    textarea.setSelectionRange(end, end);

    await act(() => {
      rewriteSelectionListener?.();
    });

    await waitFor(() => {
      expect(ipc).toHaveBeenCalledWith(
        "ai.complete",
        expect.objectContaining({ task: "commentRewrite" }),
      );
    });
  });
});
