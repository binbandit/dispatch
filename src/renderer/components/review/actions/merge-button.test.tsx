/* eslint-disable vitest/prefer-import-in-mock -- These module mocks use string paths to avoid the Promise-path typing issues in this suite. */
import type { GhPrDetail } from "@/shared/ipc";

import { toastManager } from "@/components/ui/toast";
import { MergeButton } from "@/renderer/components/review/actions/merge-button";
import "@testing-library/jest-dom/vitest";
import { ipc } from "@/renderer/lib/app/ipc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock IPC
vi.mock("@/renderer/lib/app/ipc", () => ({
  ipc: vi.fn(),
}));

// Mock toast manager
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

beforeEach(() => {
  vi.clearAllMocks();
  // Default mock for mergeQueueStatus
  vi.mocked(ipc).mockImplementation((method: string) => {
    if (method === "pr.mergeQueueStatus") {
      return Promise.resolve({ inQueue: false, position: null, estimatedTimeToMerge: null });
    }
    return Promise.resolve({});
  });
});

const createCheckRun = (conclusion: string | null = "SUCCESS") => ({
  name: "test-check",
  status: "COMPLETED",
  conclusion,
  detailsUrl: "https://example.com",
});

const createMockPr = (overrides?: Partial<GhPrDetail>) => ({
  reviewDecision: "APPROVED",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  statusCheckRollup: [createCheckRun()],
  autoMergeRequest: null,
  ...overrides,
});

const renderMergeButton = (props: Partial<Parameters<typeof MergeButton>[0]> = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const defaultProps = {
    repoTarget: { cwd: "/test", owner: "test-owner", repo: "test-repo" },
    prNumber: 123,
    pr: createMockPr(),
    canAdmin: false,
    hasMergeQueue: false,
    ...props,
  };

  return render(
    <QueryClientProvider client={queryClient}>
      <MergeButton {...defaultProps} />
    </QueryClientProvider>,
  );
};

describe("MergeButton - Auto-merge already enabled", () => {
  it("disables button when auto-merge is already enabled (merge queue mode)", () => {
    renderMergeButton({
      hasMergeQueue: true,
      pr: createMockPr({
        autoMergeRequest: {
          enabledBy: { login: "testuser" },
          mergeMethod: "SQUASH",
        },
      }),
    });

    const button = screen.getByRole("button", { name: /merge when ready/i });
    expect(button).toBeDisabled();
  });

  it("disables button when auto-merge is already enabled even if requirements are met", () => {
    renderMergeButton({
      hasMergeQueue: true,
      pr: createMockPr({
        reviewDecision: "APPROVED",
        mergeable: "MERGEABLE",
        statusCheckRollup: [createCheckRun()],
        autoMergeRequest: {
          enabledBy: { login: "testuser" },
          mergeMethod: "SQUASH",
        },
      }),
    });

    const button = screen.getByRole("button", { name: /merge when ready/i });
    expect(button).toBeDisabled();
  });

  it("enables button when auto-merge is not enabled", () => {
    renderMergeButton({
      hasMergeQueue: true,
      pr: createMockPr({
        reviewDecision: "APPROVED",
        mergeable: "MERGEABLE",
        statusCheckRollup: [createCheckRun()],
        autoMergeRequest: null,
      }),
    });

    const button = screen.getByRole("button", { name: /merge when ready/i });
    expect(button).not.toBeDisabled();
  });

  it("shows auto-merge indicator when auto-merge is enabled", () => {
    renderMergeButton({
      hasMergeQueue: true,
      pr: createMockPr({
        autoMergeRequest: {
          enabledBy: { login: "testuser" },
          mergeMethod: "SQUASH",
        },
      }),
    });

    expect(screen.getByText("Auto-merge")).toBeInTheDocument();
  });

  it("does not show auto-merge indicator when auto-merge is not enabled", () => {
    renderMergeButton({
      hasMergeQueue: true,
      pr: createMockPr({ autoMergeRequest: null }),
    });

    expect(screen.queryByText("Auto-merge")).not.toBeInTheDocument();
  });
});

describe("MergeButton - Toast messages", () => {
  it("shows 'Auto-merge enabled' toast when requirements not met", async () => {
    vi.mocked(ipc).mockResolvedValue({ queued: false });

    renderMergeButton({
      hasMergeQueue: true,
      pr: createMockPr({
        reviewDecision: "REVIEW_REQUIRED",
        mergeable: "MERGEABLE",
        statusCheckRollup: [],
        autoMergeRequest: null,
      }),
      canAdmin: true,
    });

    const button = screen.getByRole("button", { name: /merge when ready/i });
    await userEvent.click(button);

    await waitFor(() => {
      expect(toastManager.add).toHaveBeenCalledWith({
        title: "Auto-merge enabled for PR #123",
        description: "Will merge when checks pass and approvals are received",
        type: "success",
      });
    });
  });

  it("shows 'queued for merge' toast when requirements met and result.queued is true", async () => {
    vi.mocked(ipc).mockResolvedValue({ queued: true });

    renderMergeButton({
      hasMergeQueue: true,
      pr: createMockPr({
        reviewDecision: "APPROVED",
        mergeable: "MERGEABLE",
        statusCheckRollup: [createCheckRun()],
        autoMergeRequest: null,
      }),
    });

    const button = screen.getByRole("button", { name: /merge when ready/i });
    await userEvent.click(button);

    await waitFor(() => {
      expect(toastManager.add).toHaveBeenCalledWith({
        title: "PR #123 queued for merge",
        type: "success",
      });
    });
  });

  it("shows 'merged' toast when requirements met and result.queued is false", async () => {
    vi.mocked(ipc).mockResolvedValue({ queued: false });

    renderMergeButton({
      hasMergeQueue: true,
      pr: createMockPr({
        reviewDecision: "APPROVED",
        mergeable: "MERGEABLE",
        statusCheckRollup: [createCheckRun()],
        autoMergeRequest: null,
      }),
    });

    const button = screen.getByRole("button", { name: /merge when ready/i });
    await userEvent.click(button);

    await waitFor(() => {
      expect(toastManager.add).toHaveBeenCalledWith({
        title: "PR #123 merged",
        description: "Branch deleted.",
        type: "success",
      });
    });
  });

  it("shows 'merged' toast for admin override (no auto flag)", async () => {
    vi.mocked(ipc).mockResolvedValue({ queued: false });

    renderMergeButton({
      hasMergeQueue: true,
      pr: createMockPr({
        reviewDecision: "REVIEW_REQUIRED",
        mergeable: "MERGEABLE",
        statusCheckRollup: [],
      }),
      canAdmin: true,
    });

    const [, chevronButton] = screen.getAllByRole("button");
    if (!chevronButton) {
      throw new Error("Chevron button not found");
    }
    await userEvent.click(chevronButton);

    // Click "Merge now (admin)"
    const adminButton = screen.getByText(/merge now \(admin\)/i);
    await userEvent.click(adminButton);

    await waitFor(() => {
      expect(toastManager.add).toHaveBeenCalledWith({
        title: "PR #123 merged",
        description: "Branch deleted.",
        type: "success",
      });
    });
  });
});

describe("MergeButton - Admin behavior with auto-merge already enabled", () => {
  it("allows admin to skip queue even when auto-merge is enabled", async () => {
    vi.mocked(ipc).mockResolvedValue({ queued: false });

    renderMergeButton({
      hasMergeQueue: true,
      canAdmin: true,
      pr: createMockPr({
        autoMergeRequest: {
          enabledBy: { login: "testuser" },
          mergeMethod: "SQUASH",
        },
      }),
    });

    // Main button should be disabled
    const mainButton = screen.getByRole("button", { name: /merge when ready/i });
    expect(mainButton).toBeDisabled();

    const [, chevronButton] = screen.getAllByRole("button");
    if (!chevronButton) {
      throw new Error("Chevron button not found");
    }
    expect(chevronButton).not.toBeDisabled();

    await userEvent.click(chevronButton);

    // Admin can still merge via dropdown
    const adminButton = screen.getByText(/merge now \(admin\)/i);
    expect(adminButton).toBeInTheDocument();
  });

  it("shows the admin dropdown entry after opening the merge-queue menu", async () => {
    renderMergeButton({
      hasMergeQueue: true,
      canAdmin: true,
      pr: createMockPr({
        reviewDecision: "REVIEW_REQUIRED",
        mergeable: "MERGEABLE",
        statusCheckRollup: [],
        autoMergeRequest: null,
      }),
    });

    const buttons = screen.getAllByRole("button");
    const chevronButton = buttons[1];
    if (!chevronButton) {
      throw new Error("Chevron button not found");
    }

    await userEvent.click(chevronButton);

    expect(screen.getByText(/merge now \(admin\)/i)).toBeInTheDocument();
  });
});

describe("MergeButton - Standard mode (no merge queue)", () => {
  it("does not disable button based on autoMergeRequest in standard mode", () => {
    // In standard mode, auto-merge is not relevant, so button should follow normal logic
    renderMergeButton({
      hasMergeQueue: false,
      pr: createMockPr({
        reviewDecision: "APPROVED",
        mergeable: "MERGEABLE",
        statusCheckRollup: [createCheckRun()],
        autoMergeRequest: {
          enabledBy: { login: "testuser" },
          mergeMethod: "SQUASH",
        },
      }),
    });

    const button = screen.getByRole("button", { name: /squash & merge/i });
    expect(button).not.toBeDisabled();
  });

  it("shows auto-merge indicator in standard mode if present", () => {
    renderMergeButton({
      hasMergeQueue: false,
      pr: createMockPr({
        autoMergeRequest: {
          enabledBy: { login: "testuser" },
          mergeMethod: "SQUASH",
        },
      }),
    });

    expect(screen.getByText("Auto-merge")).toBeInTheDocument();
  });
});
