/* eslint-disable vitest/prefer-import-in-mock -- These module mocks need string paths for TypeScript compatibility in this suite. */
import type * as Electron from "electron";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getPreference } from "../db/repository";
import {
  getPrReactions,
  invalidateAllCaches,
  listPrsCore,
  listPrsEnrichment,
  listWorkflowRuns,
  rerunWorkflowRun,
  switchAccount,
  updatePrTitle,
} from "./gh-cli";
import { execFile } from "./shell";

// Mock Electron app
vi.mock("electron", async () => {
  const actual = await vi.importActual<typeof Electron>("electron");
  return {
    ...actual,
    app: {
      ...actual.app,
      getPath: vi.fn(() => "/tmp/test-dispatch"),
    },
  };
});

// Mock database module
vi.mock("../db/repository", () => ({
  cacheDisplayNames: vi.fn(),
  getDisplayNames: vi.fn(() => new Map()),
  getPreference: vi.fn(() => null),
  getRepoAccount: vi.fn(() => null),
  setRepoAccount: vi.fn(),
}));

vi.mock("./shell", () => ({
  execFile: vi.fn(),
}));

const execFileMock = vi.mocked(execFile);
const getPreferenceMock = vi.mocked(getPreference);

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

function createPrEnrichmentStdout(): string {
  return JSON.stringify([
    {
      number: 42,
      statusCheckRollup: [
        {
          conclusion: "SUCCESS",
          name: "CI",
          status: "COMPLETED",
        },
      ],
      additions: 24,
      deletions: 8,
      mergeable: "MERGEABLE",
      autoMergeRequest: null,
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

function resolvePendingRequest(
  resolve: (value: { stdout: string; stderr: string }) => void,
): (value: { stdout: string; stderr: string }) => void {
  return resolve;
}

function noopResolveRequest(): void {}

describe("gh-cli caching", () => {
  afterEach(() => {
    vi.clearAllMocks();
    getPreferenceMock.mockReturnValue(null);
    invalidateAllCaches();
  });

  it("dedupes concurrent PR list requests for the same repo and filter", async () => {
    let resolveRequest: (value: { stdout: string; stderr: string }) => void = noopResolveRequest;
    const pendingRequest = new Promise<{ stdout: string; stderr: string }>((resolve) => {
      resolveRequest = resolvePendingRequest(resolve);
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

  it("uses the saved pull request fetch limit for PR list calls", async () => {
    getPreferenceMock.mockImplementation((key) => (key === "prFetchLimit" ? "50" : null));

    execFileMock
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({ stdout: createPrListStdout("Limited"), stderr: "" });

    await expect(listPrsCore("/repo-limit", "all")).resolves.toMatchObject([{ title: "Limited" }]);

    expect(execFileMock).toHaveBeenNthCalledWith(
      3,
      "gh",
      expect.arrayContaining(["pr", "list", "--limit", "50"]),
      expect.anything(),
    );
  });

  it("caps broad enrichment queries so large repositories do not request status rollups for 200 PRs at once", async () => {
    getPreferenceMock.mockImplementation((key) => (key === "prFetchLimit" ? "200" : null));

    execFileMock
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({ stdout: createPrEnrichmentStdout(), stderr: "" });

    await expect(listPrsEnrichment("/repo-enrichment-limit", "all", "all")).resolves.toMatchObject([
      { number: 42 },
    ]);

    expect(execFileMock).toHaveBeenNthCalledWith(
      3,
      "gh",
      expect.arrayContaining(["pr", "list", "--state", "all", "--limit", "50"]),
      expect.anything(),
    );
  });

  it("keeps authored enrichment queries at the configured limit", async () => {
    getPreferenceMock.mockImplementation((key) => (key === "prFetchLimit" ? "200" : null));

    execFileMock
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({ stdout: createPrEnrichmentStdout(), stderr: "" });

    await expect(listPrsEnrichment("/repo-authored-enrichment", "authored")).resolves.toMatchObject(
      [{ number: 42 }],
    );

    expect(execFileMock).toHaveBeenNthCalledWith(
      3,
      "gh",
      expect.arrayContaining(["pr", "list", "--author", "@me", "--limit", "200"]),
      expect.anything(),
    );
  });

  it("bypasses the cached PR list when a forced refresh is requested", async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({ stdout: createPrListStdout("Cached"), stderr: "" })
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({ stdout: createPrListStdout("Fresh"), stderr: "" });

    await expect(listPrsCore("/repo-force-refresh", "all")).resolves.toMatchObject([
      { title: "Cached" },
    ]);

    await expect(listPrsCore("/repo-force-refresh", "all", "open", true)).resolves.toMatchObject([
      { title: "Fresh" },
    ]);

    expect(execFileMock).toHaveBeenCalledTimes(6);
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
