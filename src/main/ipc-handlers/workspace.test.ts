import { describe, expect, it, vi } from "vite-plus/test";

import { workspaceHandlers } from "./workspace";

const { addWorkspaceMock, getOwnerRepoMock, getRepoInfoMock, getWorkspacesMock } = vi.hoisted(
  () => ({
    addWorkspaceMock: vi.fn(),
    getOwnerRepoMock: vi.fn(),
    getRepoInfoMock: vi.fn(),
    getWorkspacesMock: vi.fn(),
  }),
);

vi.mock("electron", () => ({
  BrowserWindow: {
    getFocusedWindow: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
}));

vi.mock("../db/repository", () => ({
  addWorkspace: addWorkspaceMock,
  checkWorkspacePath: vi.fn(),
  getActiveWorkspace: vi.fn(),
  getRepoAccount: vi.fn(),
  getWorkspaces: getWorkspacesMock,
  removeWorkspace: vi.fn(),
  setActiveWorkspace: vi.fn(),
  unlinkWorkspacePath: vi.fn(),
}));

vi.mock("../services/git-cli", () => ({
  getRepoRoot: vi.fn(),
}));

vi.mock("../services/gh-cli", () => ({
  MAX_CONCURRENT_GH_CALLS: 3,
  getOwnerRepo: getOwnerRepoMock,
  getRepoInfo: getRepoInfoMock,
  listAccounts: vi.fn(),
  mapWithConcurrency: <T, R>(
    items: T[],
    _concurrency: number,
    fn: (item: T) => Promise<R>,
  ): Promise<PromiseSettledResult<R>[]> => Promise.allSettled(items.map((item) => fn(item))),
  searchRepos: vi.fn(),
  switchAccount: vi.fn(),
}));

describe("workspaceHandlers", () => {
  it("filters inaccessible workspaces out of the account-aware list", async () => {
    getWorkspacesMock.mockReturnValue([
      {
        id: 1,
        owner: "binbandit",
        repo: "dispatch",
        path: "/repos/dispatch",
        name: "Dispatch",
        addedAt: "2026-04-16T00:00:00Z",
      },
      {
        id: 2,
        owner: "secret",
        repo: "private-repo",
        path: "/repos/private",
        name: "Private",
        addedAt: "2026-04-16T00:00:01Z",
      },
    ]);
    getRepoInfoMock.mockImplementation((target: { owner: string; repo: string }) => {
      if (target.repo === "private-repo") {
        throw new Error(
          "GraphQL: Could not resolve to a Repository with the name 'secret/private-repo'.",
        );
      }
      return Promise.resolve({
        nameWithOwner: `${target.owner}/${target.repo}`,
        isFork: false,
        parent: null,
        canPush: true,
        hasMergeQueue: false,
        defaultBranch: "main",
      });
    });

    const result = await workspaceHandlers["workspace.accessible"]();

    expect(result).toEqual([
      expect.objectContaining({
        id: 1,
        owner: "binbandit",
        repo: "dispatch",
      }),
    ]);
    expect(getRepoInfoMock).toHaveBeenCalledTimes(2);
  });

  it("resolves migrated workspace owners before returning the accessible list", async () => {
    getWorkspacesMock.mockReturnValue([
      {
        id: 7,
        owner: "unknown",
        repo: "dispatch",
        path: "/repos/dispatch",
        name: "Dispatch",
        addedAt: "2026-04-16T00:00:00Z",
      },
    ]);
    getOwnerRepoMock.mockResolvedValue({ owner: "binbandit", repo: "dispatch" });
    getRepoInfoMock.mockResolvedValue({
      nameWithOwner: "binbandit/dispatch",
      isFork: false,
      parent: null,
      canPush: true,
      hasMergeQueue: false,
      defaultBranch: "main",
    });

    const result = await workspaceHandlers["workspace.accessible"]();

    expect(addWorkspaceMock).toHaveBeenCalledWith({
      owner: "binbandit",
      repo: "dispatch",
      path: "/repos/dispatch",
      name: "Dispatch",
    });
    expect(result[0]).toEqual(
      expect.objectContaining({
        owner: "binbandit",
        repo: "dispatch",
      }),
    );
  });
});
