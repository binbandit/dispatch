import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getPrReactions,
  invalidateAllCaches,
  listPrsCore,
  listWorkflowRuns,
  rerunWorkflowRun,
  switchAccount,
  updatePrTitle,
} from "./gh-cli";
import { execFile } from "./shell";

// Mock Electron app
vi.mock(import("electron"), () => ({
  app: {
    getPath: vi.fn(() => "/tmp/test-dispatch"),
  },
}));

// Mock database module
vi.mock(import("../db/repository"), () => ({
  cacheDisplayNames: vi.fn(),
  getDisplayNames: vi.fn(() => new Map()),
  getRepoAccount: vi.fn(() => null),
  setRepoAccount: vi.fn(),
}));

vi.mock(import("./shell"), () => ({
  execFile: vi.fn(),
}));

const execFileMock = vi.mocked(execFile);

function createPrListStdout(title: string): string {
  return JSON.stringify([
    {
      number: 42,
      title,
      author: { login: "octocat" },
      headRefName: "feature/cache",
      baseRefName: "main",
      reviewDecision: "REVIEW_REQUIRED",
      updatedAt: "2026-03-20T00:00:00Z",
      url: "https://github.com/octo/dispatch/pull/42",
      isDraft: false,
    },
  ]);
}

function createRepoInfoStdout({
  nameWithOwner = "octo/dispatch",
  isFork = false,
  parent = null,
}: {
  nameWithOwner?: string;
  isFork?: boolean;
  parent?: string | null;
} = {}): string {
  const [parentOwner, parentRepo] = parent?.split("/") ?? [];

  return JSON.stringify({
    defaultBranchRef: { name: "main" },
    isFork,
    nameWithOwner,
    parent: parentOwner && parentRepo ? { name: parentRepo, owner: { login: parentOwner } } : null,
    viewerPermission: "WRITE",
  });
}

function createWorkflowRunsStdout(attempt: number): string {
  return JSON.stringify([
    {
      databaseId: 99,
      displayTitle: "CI",
      name: "CI",
      status: "completed",
      conclusion: attempt > 1 ? "success" : "failure",
      headBranch: "main",
      createdAt: "2026-03-20T00:00:00Z",
      updatedAt: "2026-03-20T00:05:00Z",
      event: "push",
      workflowName: "CI",
      attempt,
    },
  ]);
}

describe("gh-cli caching", () => {
  afterEach(() => {
    vi.clearAllMocks();
    invalidateAllCaches();
  });

  it("dedupes concurrent PR list requests for the same repo and filter", async () => {
    let resolveRequest: (value: { stdout: string; stderr: string }) => void = () => {};
    const pendingRequest = new Promise<{ stdout: string; stderr: string }>((resolve) => {
      resolveRequest = resolve;
    });

    execFileMock
      .mockImplementationOnce(() => pendingRequest)
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({ stdout: createPrListStdout("Deduped"), stderr: "" });

    const firstRequest = listPrsCore("/repo-dedupe", "all");
    const secondRequest = listPrsCore("/repo-dedupe", "all");

    expect(execFileMock.mock.calls).toHaveLength(1);

    resolveRequest({ stdout: createRepoInfoStdout(), stderr: "" });

    await expect(firstRequest).resolves.toMatchObject([{ title: "Deduped" }]);
    await expect(secondRequest).resolves.toMatchObject([{ title: "Deduped" }]);
    expect(execFileMock.mock.calls).toHaveLength(3);
    expect(execFileMock).toHaveBeenNthCalledWith(
      3,
      "gh",
      expect.arrayContaining(["pr", "list", "--limit", "200"]),
      expect.anything(),
    );
  });

  it("invalidates cached PR lists after a title edit", async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({ stdout: createPrListStdout("Before edit"), stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({ stdout: createPrListStdout("After edit"), stderr: "" });

    await expect(listPrsCore("/repo-title", "all")).resolves.toMatchObject([
      { title: "Before edit" },
    ]);

    await updatePrTitle("/repo-title", 42, "After edit");

    await expect(listPrsCore("/repo-title", "all")).resolves.toMatchObject([
      { title: "After edit" },
    ]);
    expect(execFileMock).toHaveBeenCalledTimes(7);
  });

  it("invalidates cached workflow runs after a rerun", async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: createWorkflowRunsStdout(1), stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockResolvedValueOnce({ stdout: createWorkflowRunsStdout(2), stderr: "" });

    await expect(listWorkflowRuns("/repo-workflows")).resolves.toMatchObject([{ attempt: 1 }]);

    await rerunWorkflowRun("/repo-workflows", 99);

    await expect(listWorkflowRuns("/repo-workflows")).resolves.toMatchObject([{ attempt: 2 }]);
    expect(execFileMock).toHaveBeenCalledTimes(3);
  });

  it("clears cached GitHub data after switching accounts", async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({ stdout: createPrListStdout("Before switch"), stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({ stdout: createPrListStdout("After switch"), stderr: "" });

    await expect(listPrsCore("/repo-account", "reviewRequested")).resolves.toMatchObject([
      { title: "Before switch" },
    ]);

    await switchAccount("github.com", "alt-user");

    await expect(listPrsCore("/repo-account", "reviewRequested")).resolves.toMatchObject([
      { title: "After switch" },
    ]);
    expect(execFileMock).toHaveBeenCalledTimes(7);
  });

  it("uses the upstream repo for PR reactions when the current clone is a fork", async () => {
    execFileMock
      .mockResolvedValueOnce({
        stdout: createRepoInfoStdout({
          isFork: true,
          nameWithOwner: "binbandit/t3code",
          parent: "pingdotgg/t3code",
        }),
        stderr: "",
      })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                id: "PR_node",
                reactionGroups: [],
                comments: { nodes: [] },
                reviewThreads: { nodes: [] },
              },
            },
          },
        }),
        stderr: "",
      });

    await expect(getPrReactions("/repo-fork", 1112)).resolves.toEqual({
      prNodeId: "PR_node",
      prBody: [],
      issueComments: {},
      reviewComments: {},
    });

    expect(execFileMock).toHaveBeenNthCalledWith(
      3,
      "gh",
      expect.arrayContaining(["-f", "owner=pingdotgg", "-f", "repo=t3code"]),
      expect.anything(),
    );
  });
});
