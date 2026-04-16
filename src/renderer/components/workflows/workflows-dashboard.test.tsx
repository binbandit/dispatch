import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";

import { WorkflowsDashboard } from "@/renderer/components/workflows/workflows-dashboard";
import { ipc } from "@/renderer/lib/app/ipc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock(import("@/renderer/lib/app/ipc"), () => ({
  ipc: vi.fn(),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button
      type="button"
      {...props}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/resizable", () => ({
  ResizableHandle: () => null,
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/spinner", () => ({
  Spinner: () => <div>Loading</div>,
}));

vi.mock("@/components/ui/toast", () => ({
  toastManager: {
    add: vi.fn(),
  },
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipPopup: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children, render }: { children?: ReactNode; render?: ReactNode }) => (
    <>{render ?? children}</>
  ),
}));

vi.mock("@/renderer/components/shared/confirm-dialog", () => ({
  ConfirmDialog: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));

vi.mock("@/renderer/components/shared/loading-skeletons", () => ({
  WorkflowRunsSkeleton: () => <div>Loading workflows…</div>,
}));

vi.mock("@/renderer/components/workflows/run-comparison", () => ({
  RunComparison: () => <div>Run comparison</div>,
}));

vi.mock("@/renderer/components/workflows/run-detail", () => ({
  RunDetail: () => <div>Run detail</div>,
}));

vi.mock("@/renderer/lib/app/router", () => ({
  useRouter: () => ({
    route: { view: "workflows" as const, runId: null, fromPr: null },
    navigate: vi.fn(),
  }),
}));

vi.mock("@/renderer/lib/app/workspace-context", () => ({
  useWorkspace: () => ({
    nwo: "binbandit/dispatch",
    repoTarget: { cwd: "/repos/dispatch", owner: "binbandit", repo: "dispatch" },
  }),
}));

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <WorkflowsDashboard />
    </QueryClientProvider>,
  );
}

describe("WorkflowsDashboard", () => {
  it("shows an explicit error instead of stale workflow content when loading fails", async () => {
    vi.mocked(ipc).mockImplementation((method) => {
      switch (method) {
        case "workflows.list": {
          return Promise.reject(
            new Error(
              "GraphQL: Could not resolve to a Repository with the name 'binbandit/dispatch'.",
            ),
          );
        }
        case "workflows.runs": {
          return Promise.reject(new Error("Not Found"));
        }
        default: {
          throw new Error(`Unexpected IPC method: ${String(method)}`);
        }
      }
    });

    renderDashboard();

    expect(
      await screen.findByText("Could not load workflows for this repository."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "GraphQL: Could not resolve to a Repository with the name 'binbandit/dispatch'.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Run detail")).not.toBeInTheDocument();
  });
});
