import { describe, expect, it, vi } from "vite-plus/test";

const { getActiveWorkspaceMock, getRepoInfoMock, setRepoAccountMock, switchAccountMock } =
  vi.hoisted(() => ({
    getActiveWorkspaceMock: vi.fn(),
    getRepoInfoMock: vi.fn(),
    setRepoAccountMock: vi.fn(),
    switchAccountMock: vi.fn(),
  }));

vi.mock("../db/repository", () => ({
  getActiveWorkspace: getActiveWorkspaceMock,
  getRepoAccount: vi.fn(),
  setRepoAccount: setRepoAccountMock,
}));

vi.mock("../services/gh-cli", () => ({
  getAuthenticatedUser: vi.fn(),
  getAvatarUrl: vi.fn(),
  getRepoHost: vi.fn(),
  getRepoInfo: getRepoInfoMock,
  getUserProfile: vi.fn(),
  isGhAuthenticated: vi.fn(),
  listAccounts: vi.fn(),
  switchAccount: switchAccountMock,
}));

vi.mock("../services/shell", () => ({
  whichVersion: vi.fn(),
}));

import { environmentHandlers } from "./environment";

describe("environmentHandlers", () => {
  it("keeps the prior repo-account mapping when the switched account cannot access the active repo", async () => {
    getActiveWorkspaceMock.mockReturnValue({
      id: 1,
      owner: "binbandit",
      repo: "dispatch",
      path: "/repos/dispatch",
      name: "Dispatch",
    });
    getRepoInfoMock.mockRejectedValue(new Error("Repository not found"));

    await environmentHandlers["env.switchAccount"]({
      host: "github.com",
      login: "alt-user",
    });

    expect(switchAccountMock).toHaveBeenCalledWith("github.com", "alt-user");
    expect(setRepoAccountMock).not.toHaveBeenCalled();
  });

  it("stores the repo-account mapping when the switched account can access the active repo", async () => {
    getActiveWorkspaceMock.mockReturnValue({
      id: 1,
      owner: "binbandit",
      repo: "dispatch",
      path: "/repos/dispatch",
      name: "Dispatch",
    });
    getRepoInfoMock.mockResolvedValue({
      nameWithOwner: "binbandit/dispatch",
      isFork: false,
      parent: null,
      canPush: true,
      hasMergeQueue: false,
      defaultBranch: "main",
    });

    await environmentHandlers["env.switchAccount"]({
      host: "github.com",
      login: "alt-user",
    });

    expect(setRepoAccountMock).toHaveBeenCalledWith("/repos/dispatch", "github.com", "alt-user");
  });
});
