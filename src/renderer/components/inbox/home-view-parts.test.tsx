import type { EnrichedDashboardPr, PrSection } from "@/renderer/lib/inbox/home-prs";
/* eslint-disable vitest/prefer-import-in-mock -- These module mocks use string paths to keep the suite simple. */
import type { GhPrDetail, IpcApi, RepoInfo } from "@/shared/ipc";

import { PrSectionView } from "@/renderer/components/inbox/home-view-parts";
import { ipc } from "@/renderer/lib/app/ipc";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

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
  toastManager: toastManagerMock,
}));

const createMockItem = (): EnrichedDashboardPr => ({
  hasNewActivity: false,
  pr: {
    number: 123,
    title: "Ship queue support",
    state: "OPEN",
    author: { login: "brayden", name: "Brayden" },
    headRefName: "feature/queue",
    baseRefName: "main",
    reviewDecision: "APPROVED",
    updatedAt: "2026-04-15T01:00:00.000Z",
    url: "https://example.com/pull/123",
    isDraft: false,
    additions: 24,
    deletions: 6,
    workspace: "dispatch",
    workspacePath: "/repo/dispatch",
    repository: "dispatch",
    pullRequestRepository: "acme/dispatch",
    isForkWorkspace: false,
  },
});

const createMockDetail = (): GhPrDetail => ({
  number: 123,
  title: "Ship queue support",
  state: "OPEN",
  body: "",
  author: { login: "brayden", name: "Brayden" },
  headRefName: "feature/queue",
  baseRefName: "main",
  headRefOid: "abc123",
  reviewDecision: "APPROVED",
  mergeable: "MERGEABLE",
  statusCheckRollup: [
    {
      name: "ci",
      status: "COMPLETED",
      conclusion: "SUCCESS",
      detailsUrl: "https://example.com/checks/1",
    },
  ],
  reviews: [],
  files: [],
  labels: [],
  autoMergeRequest: null,
  mergeStateStatus: "CLEAN",
  createdAt: "2026-04-14T23:00:00.000Z",
  updatedAt: "2026-04-15T01:00:00.000Z",
  closedAt: null,
  mergedAt: null,
  url: "https://example.com/pull/123",
  isDraft: false,
  additions: 24,
  deletions: 6,
});

function installIpcMock({
  repoInfo,
  detail = createMockDetail(),
  mergeResult = { queued: false },
}: {
  repoInfo?: Partial<RepoInfo>;
  detail?: GhPrDetail;
  mergeResult?: { queued: boolean };
} = {}) {
  const resolvedRepoInfo: RepoInfo = {
    nameWithOwner: "acme/dispatch",
    isFork: false,
    parent: null,
    canPush: true,
    hasMergeQueue: false,
    defaultBranch: "main",
    ...repoInfo,
  };

  vi.mocked(ipc).mockImplementation(((method: keyof IpcApi) => {
    if (method === "repo.info") {
      return Promise.resolve(resolvedRepoInfo);
    }
    if (method === "pr.detail") {
      return Promise.resolve(detail);
    }
    if (method === "pr.merge") {
      return Promise.resolve(mergeResult);
    }
    return Promise.resolve(null);
  }) as typeof ipc);
}

const renderShipSection = (item: EnrichedDashboardPr = createMockItem()) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const section: PrSection = {
    id: "ship",
    title: "Ready to ship",
    items: [item],
  };

  return render(
    <QueryClientProvider client={queryClient}>
      <PrSectionView
        section={section}
        collapsed={false}
        onToggle={() => {}}
        currentUser="brayden"
        nameFormat="login"
        onSelectPr={() => {}}
        focusIndex={0}
        flatPrs={[item]}
        animationDelay={0}
      />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  installIpcMock();
});

describe("PrSectionView merge actions", () => {
  it("uses merge queue flags for ship actions when the repo has a merge queue", async () => {
    installIpcMock({
      repoInfo: { hasMergeQueue: true },
      mergeResult: { queued: true },
    });

    renderShipSection();

    await userEvent.click(screen.getByRole("button", { name: /merge pull request #123/i }));

    await waitFor(() => {
      const mergeCall = vi.mocked(ipc).mock.calls.find(([method]) => method === "pr.merge");

      expect(mergeCall?.[1]).toMatchObject({
        cwd: "/repo/dispatch",
        owner: "acme",
        repo: "dispatch",
        prNumber: 123,
        strategy: "squash",
        auto: true,
        hasMergeQueue: true,
      });
    });
  });

  it("keeps the standard merge path for repos without a merge queue", async () => {
    renderShipSection();

    await userEvent.click(screen.getByRole("button", { name: /merge pull request #123/i }));

    await waitFor(() => {
      const mergeCall = vi.mocked(ipc).mock.calls.find(([method]) => method === "pr.merge");
      const mergeArgs = mergeCall?.[1] as Record<string, unknown> | undefined;

      expect(mergeArgs).toMatchObject({
        cwd: "/repo/dispatch",
        owner: "acme",
        repo: "dispatch",
        prNumber: 123,
        strategy: "squash",
        hasMergeQueue: false,
      });
      expect(mergeArgs?.auto).toBe(false);
      expect(mergeArgs?.admin).toBeUndefined();
    });
  });
});
