import type { GhWorkflowRunDetail } from "@/shared/ipc";

import { RunDetail } from "@/renderer/components/workflows/run-detail";
import "@testing-library/jest-dom/vitest";
import { ipc } from "@/renderer/lib/app/ipc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(import("@/renderer/lib/app/ipc"), () => ({
  ipc: vi.fn(),
}));

vi.mock(import("@/renderer/components/review/ai/ai-failure-explainer"), () => ({
  AiFailureExplainer: ({ checkName }: { checkName: string }) => (
    <div>{`AI explanation action: ${checkName}`}</div>
  ),
}));

function createRunDetail(overrides?: Partial<GhWorkflowRunDetail>): GhWorkflowRunDetail {
  return {
    databaseId: 99,
    displayTitle: "Fix failing workflow",
    name: "ci.yml",
    status: "completed",
    conclusion: "failure",
    headBranch: "main",
    createdAt: "2026-04-01T10:00:00Z",
    updatedAt: "2026-04-01T10:05:00Z",
    event: "push",
    workflowName: "CI",
    attempt: 1,
    headSha: "1234567890abcdef",
    workflowDatabaseId: 1,
    jobs: [
      {
        name: "test",
        status: "completed",
        conclusion: "failure",
        startedAt: "2026-04-01T10:00:00Z",
        completedAt: "2026-04-01T10:02:00Z",
        steps: [
          {
            name: "Install",
            status: "completed",
            conclusion: "success",
            number: 1,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function renderRunDetail() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RunDetail
        repoTarget={{ cwd: "/tmp/dispatch", owner: "test-owner", repo: "test-repo" }}
        runId={99}
      />
    </QueryClientProvider>,
  );
}

describe("RunDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the AI explanation action for failed workflow runs", async () => {
    vi.mocked(ipc).mockImplementation((method) => {
      if (method === "workflows.runDetail") {
        return Promise.resolve(createRunDetail());
      }

      throw new Error(`Unexpected IPC method: ${String(method)}`);
    });

    renderRunDetail();

    expect(await screen.findByText("Fix failing workflow")).toBeInTheDocument();
    expect(screen.getByText("AI explanation action: CI / test")).toBeInTheDocument();
  });

  it("hides the AI explanation action for successful workflow runs", async () => {
    vi.mocked(ipc).mockImplementation((method) => {
      if (method === "workflows.runDetail") {
        return Promise.resolve(
          createRunDetail({
            conclusion: "success",
            jobs: [
              {
                name: "test",
                status: "completed",
                conclusion: "success",
                startedAt: "2026-04-01T10:00:00Z",
                completedAt: "2026-04-01T10:02:00Z",
                steps: [],
              },
            ],
          }),
        );
      }

      throw new Error(`Unexpected IPC method: ${String(method)}`);
    });

    renderRunDetail();

    expect(await screen.findByText("Fix failing workflow")).toBeInTheDocument();
    expect(screen.queryByText(/AI explanation action:/)).not.toBeInTheDocument();
  });
});
