import type { AiResolvedConfig, AiTaskId } from "@/shared/ipc";
import type { ComponentProps } from "react";

import { AiReviewSummary } from "@/renderer/components/review/ai/ai-review-summary";
import "@testing-library/jest-dom/vitest";
import { ipc } from "@/renderer/lib/app/ipc";
import { WorkspaceProvider } from "@/renderer/lib/app/workspace-context";
import {
  buildAiReviewSummarySnapshotKey,
  parseAiReviewConfidencePayload,
  parseAiReviewSummaryPayload,
} from "@/shared/ai-review-summary";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(import("@/renderer/lib/app/ipc"), () => ({
  ipc: vi.fn(),
}));

vi.mock(import("@/renderer/components/shared/markdown-body"), () => ({
  MarkdownBody: ({ content }: { content: string }) => <div>{content}</div>,
}));

const BASE_PROPS = {
  prNumber: 42,
  prTitle: "Tighten cached AI summary",
  prBody: "This pull request wires persistent summary caching into the PR overlay.",
  author: "brayden",
  files: [{ path: "src/renderer/components/ai-review-summary.tsx", additions: 24, deletions: 8 }],
  diffSnippet: "const cached = readSummary();\nif (cached) return cached;",
} as const;

function throwUninitializedAiComplete(): never {
  throw new Error("AI completion promise was not initialized");
}

function createAiConfigResponse(): AiResolvedConfig {
  return {
    isConfigured: true,
    providers: {
      codex: {
        provider: "codex",
        model: "gpt-5.4",
        binaryPath: null,
        homePath: null,
        baseUrl: null,
        isConfigured: true,
        modelSource: "preference",
        binaryPathSource: "none",
        homePathSource: "none",
        baseUrlSource: "none",
        modelEnvVar: null,
        binaryPathEnvVar: null,
        homePathEnvVar: null,
        baseUrlEnvVar: null,
      },
      claude: {
        provider: "claude",
        model: null,
        binaryPath: null,
        homePath: null,
        baseUrl: null,
        isConfigured: false,
        modelSource: "none",
        binaryPathSource: "none",
        homePathSource: "none",
        baseUrlSource: "none",
        modelEnvVar: null,
        binaryPathEnvVar: null,
        homePathEnvVar: null,
        baseUrlEnvVar: null,
      },
      copilot: {
        provider: "copilot",
        model: null,
        binaryPath: null,
        homePath: null,
        baseUrl: null,
        isConfigured: false,
        modelSource: "none",
        binaryPathSource: "none",
        homePathSource: "none",
        baseUrlSource: "none",
        modelEnvVar: null,
        binaryPathEnvVar: null,
        homePathEnvVar: null,
        baseUrlEnvVar: null,
      },
      ollama: {
        provider: "ollama",
        model: null,
        binaryPath: null,
        homePath: null,
        baseUrl: null,
        isConfigured: false,
        modelSource: "none",
        binaryPathSource: "none",
        homePathSource: "none",
        baseUrlSource: "none",
        modelEnvVar: null,
        binaryPathEnvVar: null,
        homePathEnvVar: null,
        baseUrlEnvVar: null,
      },
      opencode: {
        provider: "opencode",
        model: null,
        binaryPath: null,
        homePath: null,
        baseUrl: null,
        isConfigured: false,
        modelSource: "none",
        binaryPathSource: "none",
        homePathSource: "none",
        baseUrlSource: "none",
        modelEnvVar: null,
        binaryPathEnvVar: null,
        homePathEnvVar: null,
        baseUrlEnvVar: null,
      },
    },
    slots: {
      big: {
        slot: "big",
        provider: "codex",
        model: "gpt-5.4",
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
      },
      small: {
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
      },
    },
    tasks: {
      codeExplanation: {
        task: "codeExplanation",
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
      },
      failureExplanation: {
        task: "failureExplanation",
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
      },
      reviewSummary: {
        task: "reviewSummary",
        selectedSlot: "big",
        selectedSlotSource: "default",
        slot: "big",
        provider: "codex",
        model: "gpt-5.4",
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
      },
      reviewConfidence: {
        task: "reviewConfidence",
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
      },
      triage: {
        task: "triage",
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
      },
      commentSuggestions: {
        task: "commentSuggestions",
        selectedSlot: "big",
        selectedSlotSource: "default",
        slot: "big",
        provider: "codex",
        model: "gpt-5.4",
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
      },
    },
  };
}

function renderSummary(props: Partial<ComponentProps<typeof AiReviewSummary>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider
        workspace={{ id: 1, owner: "test", repo: "dispatch", path: "/tmp/dispatch" }}
      >
        <AiReviewSummary
          {...BASE_PROPS}
          {...props}
        />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(ipc).mockImplementation((method, args) => {
    if (method === "preferences.get") {
      const payload = args as { key: string };
      return Promise.resolve(payload.key === "aiEnabled" ? "true" : null);
    }
    if (method === "ai.config") {
      return Promise.resolve(createAiConfigResponse());
    }
    if (method === "ai.reviewSummary.get") {
      return Promise.resolve(null);
    }
    if (method === "ai.complete") {
      const payload = args as { task?: AiTaskId };
      return Promise.resolve(
        payload.task === "reviewConfidence"
          ? JSON.stringify({
              confidenceScore: 78,
            })
          : JSON.stringify({
              summary: "- Cached summary",
            }),
      );
    }
    if (method === "ai.reviewSummary.set") {
      const payload = args as {
        summary: string;
        confidenceScore: number | null;
        snapshotKey: string;
      };
      return Promise.resolve({
        summary: payload.summary,
        confidenceScore: payload.confidenceScore,
        snapshotKey: payload.snapshotKey,
        generatedAt: "2026-03-31 12:00:00",
      });
    }
    throw new Error(`Unexpected IPC call: ${String(method)}`);
  });
});

describe("AiReviewSummary", () => {
  it("treats AI as enabled when the preference has not been saved yet", async () => {
    vi.mocked(ipc).mockImplementation((method, args) => {
      if (method === "preferences.get") {
        const payload = args as { key: string };
        return Promise.resolve(payload.key === "aiEnabled" ? null : null);
      }
      if (method === "ai.config") {
        return Promise.resolve(createAiConfigResponse());
      }
      if (method === "ai.reviewSummary.get") {
        return Promise.resolve(null);
      }
      if (method === "ai.complete") {
        const payload = args as { task?: AiTaskId };
        return Promise.resolve(
          payload.task === "reviewConfidence"
            ? JSON.stringify({
                confidenceScore: 78,
              })
            : JSON.stringify({
                summary: "- Cached summary",
              }),
        );
      }
      if (method === "ai.reviewSummary.set") {
        const payload = args as {
          summary: string;
          confidenceScore: number | null;
          snapshotKey: string;
        };
        return Promise.resolve({
          summary: payload.summary,
          confidenceScore: payload.confidenceScore,
          snapshotKey: payload.snapshotKey,
          generatedAt: "2026-03-31 12:00:00",
        });
      }
      throw new Error(`Unexpected IPC call: ${String(method)}`);
    });

    renderSummary({ variant: "card" });

    await userEvent.click(await screen.findByRole("button", { name: /ai summary/i }));

    await waitFor(() => {
      expect(ipc).toHaveBeenCalledWith(
        "ai.complete",
        expect.objectContaining({ task: "reviewSummary" }),
      );
    });
  });

  it("shows a refresh prompt when the cached summary no longer matches the PR snapshot", async () => {
    vi.mocked(ipc).mockImplementation((method) => {
      if (method === "preferences.get") {
        return Promise.resolve("true");
      }
      if (method === "ai.config") {
        return Promise.resolve(createAiConfigResponse());
      }
      if (method === "ai.reviewSummary.get") {
        return Promise.resolve({
          summary: "- Cached summary",
          confidenceScore: 61,
          snapshotKey: "old-snapshot",
          generatedAt: "2026-03-31 11:00:00",
        });
      }
      throw new Error(`Unexpected IPC call: ${String(method)}`);
    });

    renderSummary({ variant: "card" });

    expect(await screen.findByText("Summary Out Of Date")).toBeInTheDocument();
    expect(
      screen.getByText("This PR changed since the last summary was generated."),
    ).toBeInTheDocument();
    expect(screen.getByText("- Cached summary")).toBeInTheDocument();
    expect(screen.getByText("AI 61/100")).toBeInTheDocument();
    expect(screen.getByText("1/1 files")).toBeInTheDocument();
    expect(screen.getByText("Changed files only")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /refresh/i })).not.toHaveLength(0);
  });

  it("generates and persists a summary from the compact card trigger", async () => {
    const expectedSnapshotKey = buildAiReviewSummarySnapshotKey(BASE_PROPS);
    const expectedPayload = parseAiReviewSummaryPayload(
      JSON.stringify({
        summary: "- Cached summary",
      }),
    );
    const expectedConfidence = parseAiReviewConfidencePayload(
      JSON.stringify({
        confidenceScore: 78,
      }),
    );

    renderSummary({ variant: "card" });

    await userEvent.click(await screen.findByRole("button", { name: /ai summary/i }));

    await waitFor(() => {
      expect(ipc).toHaveBeenCalledWith(
        "ai.complete",
        expect.objectContaining({ task: "reviewSummary" }),
      );
      expect(ipc).toHaveBeenCalledWith(
        "ai.complete",
        expect.objectContaining({ task: "reviewConfidence" }),
      );
    });

    expect(ipc).toHaveBeenCalledWith("ai.reviewSummary.set", {
      nwo: "test/dispatch",
      prNumber: BASE_PROPS.prNumber,
      snapshotKey: expectedSnapshotKey,
      summary: expectedPayload?.summary,
      confidenceScore: expectedConfidence?.confidenceScore ?? null,
    });

    const cachedSummaryMatches = await screen.findAllByText("- Cached summary");
    expect(cachedSummaryMatches.length).toBeGreaterThan(0);
    expect(screen.getByText("AI 78/100")).toBeInTheDocument();
  });

  it("replaces the cached summary with a loading state while refreshing", async () => {
    const currentSnapshotKey = buildAiReviewSummarySnapshotKey(BASE_PROPS);
    let resolveSummary: (value: string) => void = throwUninitializedAiComplete;
    let resolveConfidence: (value: string) => void = throwUninitializedAiComplete;

    vi.mocked(ipc).mockImplementation((method, args) => {
      if (method === "preferences.get") {
        return Promise.resolve("true");
      }
      if (method === "ai.config") {
        return Promise.resolve(createAiConfigResponse());
      }
      if (method === "ai.reviewSummary.get") {
        return Promise.resolve({
          summary: "- Cached summary",
          confidenceScore: 61,
          snapshotKey: currentSnapshotKey,
          generatedAt: "2026-03-31 11:00:00",
        });
      }
      if (method === "ai.complete") {
        const payload = args as { task?: AiTaskId };
        return new Promise<string>((resolve) => {
          if (payload.task === "reviewConfidence") {
            resolveConfidence = resolve;
            return;
          }
          resolveSummary = resolve;
        });
      }
      if (method === "ai.reviewSummary.set") {
        const payload = args as {
          summary: string;
          confidenceScore: number | null;
          snapshotKey: string;
        };
        return Promise.resolve({
          summary: payload.summary,
          confidenceScore: payload.confidenceScore,
          snapshotKey: payload.snapshotKey,
          generatedAt: "2026-03-31 12:00:00",
        });
      }
      throw new Error(`Unexpected IPC call: ${String(method)}`);
    });

    renderSummary({ variant: "card" });

    expect(await screen.findByText("- Cached summary")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));

    expect(await screen.findByText("Refreshing summary…")).toBeInTheDocument();
    expect(screen.queryByText("- Cached summary")).not.toBeInTheDocument();

    resolveSummary(
      JSON.stringify({
        summary: "- Refreshed summary",
      }),
    );
    resolveConfidence(
      JSON.stringify({
        confidenceScore: 84,
      }),
    );

    expect(await screen.findByText("- Refreshed summary")).toBeInTheDocument();
    expect(screen.getByText("AI 84/100")).toBeInTheDocument();
  });
});
