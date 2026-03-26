import { afterEach, describe, expect, it, vi } from "vitest";

import {
  invalidateAllCaches,
  listPrsCore,
  listWorkflowRuns,
  rerunWorkflowRun,
  switchAccount,
  updatePrTitle,
} from "./gh-cli";
import { execFile } from "./shell";

// Mock Electron app
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/test-dispatch"),
  },
}));

// Mock database module
vi.mock("../db/repository", () => ({
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

    execFileMock.mockImplementationOnce(() => pendingRequest);

    const firstRequest = listPrsCore("/repo-dedupe", "all");
    const secondRequest = listPrsCore("/repo-dedupe", "all");

    expect(execFileMock.mock.calls).toHaveLength(1);

    resolveRequest({ stdout: createPrListStdout("Deduped"), stderr: "" });

    await expect(firstRequest).resolves.toMatchObject([{ title: "Deduped" }]);
    await expect(secondRequest).resolves.toMatchObject([{ title: "Deduped" }]);
    expect(execFileMock.mock.calls).toHaveLength(1);
  });

  it("invalidates cached PR lists after a title edit", async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: createPrListStdout("Before edit"), stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockResolvedValueOnce({ stdout: createPrListStdout("After edit"), stderr: "" });

    await expect(listPrsCore("/repo-title", "all")).resolves.toMatchObject([
      { title: "Before edit" },
    ]);

    await updatePrTitle("/repo-title", 42, "After edit");

    await expect(listPrsCore("/repo-title", "all")).resolves.toMatchObject([
      { title: "After edit" },
    ]);
    expect(execFileMock).toHaveBeenCalledTimes(3);
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
      .mockResolvedValueOnce({ stdout: createPrListStdout("Before switch"), stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockResolvedValueOnce({ stdout: createPrListStdout("After switch"), stderr: "" });

    await expect(listPrsCore("/repo-account", "reviewRequested")).resolves.toMatchObject([
      { title: "Before switch" },
    ]);

    await switchAccount("github.com", "alt-user");

    await expect(listPrsCore("/repo-account", "reviewRequested")).resolves.toMatchObject([
      { title: "After switch" },
    ]);
    expect(execFileMock).toHaveBeenCalledTimes(3);
  });
});
