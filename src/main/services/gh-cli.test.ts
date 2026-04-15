/* eslint-disable vitest/prefer-import-in-mock -- These module mocks need string paths for TypeScript compatibility in this suite. */
import type * as Electron from "electron";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  getPrCache,
  getPrListCache,
  getPreference,
  invalidatePersistedPrCaches,
} from "../db/repository";
import {
  createReviewComment,
  getIssueComments,
  getPrDetail,
  getPrDiff,
  getPrReactions,
  getPrReviewThreads,
  invalidateAllCaches,
  listPrsCore,
  listPrsEnrichment,
  listWorkflowRuns,
  rerunWorkflowRun,
  submitReview,
  switchAccount,
  updatePrTitle,
} from "./gh-cli";
import { execFile } from "./shell";

// Mock Electron app
vi.mock("electron", async () => {
  const actual = await vi.importActual<typeof Electron>("electron");
  return {
    ...actual,
    BrowserWindow: {
      ...actual.BrowserWindow,
      getAllWindows: vi.fn(() => []),
    },
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
  getPrCache: vi.fn(() => null),
  getPrListCache: vi.fn(() => null),
  getPreference: vi.fn(() => null),
  getRepoAccount: vi.fn(() => null),
  invalidatePersistedPrCaches: vi.fn(),
  savePrDetail: vi.fn(),
  savePrListCache: vi.fn(),
  setRepoAccount: vi.fn(),
}));

vi.mock("./shell", () => ({
  execFile: vi.fn(),
}));

const execFileMock = vi.mocked(execFile);
const getPrCacheMock = vi.mocked(getPrCache);
const getPrListCacheMock = vi.mocked(getPrListCache);
const getPreferenceMock = vi.mocked(getPreference);
const invalidatePersistedPrCachesMock = vi.mocked(invalidatePersistedPrCaches);

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

function createPrDetailStdout({
  state = "OPEN",
  title = "Large review surface",
  changedFiles = 1,
  files = [{ path: "src/a.ts", additions: 3, deletions: 1 }],
}: {
  state?: "OPEN" | "CLOSED" | "MERGED";
  title?: string;
  changedFiles?: number;
  files?: Array<{ path: string; additions: number; deletions: number }>;
} = {}): string {
  return JSON.stringify({
    number: 42,
    state,
    title,
    body: "Covers a wide set of changes.",
    author: { login: "octocat" },
    headRefName: "feature/huge-pr",
    baseRefName: "main",
    headRefOid: "abc123def456",
    reviewDecision: "REVIEW_REQUIRED",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    autoMergeRequest: null,
    statusCheckRollup: [],
    reviews: [],
    files,
    labels: [],
    createdAt: "2026-03-20T00:00:00Z",
    updatedAt: "2026-03-20T00:05:00Z",
    url: "https://github.com/octo/dispatch/pull/42",
    isDraft: false,
    additions: 240,
    changedFiles,
    deletions: 120,
  });
}

function createPullRequestFilesStdout(count: number, start = 1): string {
  return JSON.stringify(
    Array.from({ length: count }, (_, index) => {
      const fileNumber = start + index;

      return {
        filename: `src/file-${fileNumber}.ts`,
        status: "modified",
        additions: 2,
        deletions: 1,
        patch: `@@ -1 +1 @@\n-old-${fileNumber}\n+new-${fileNumber}`,
      };
    }),
  );
}

function createGraphqlPullRequestNode({
  number = 42,
  title = "Unlimited",
  state = "OPEN",
  reviewDecision = "REVIEW_REQUIRED",
  authorLogin = "octocat",
  authorName = "The Octocat",
  statusNodes = [],
  additions = 24,
  deletions = 8,
  mergeable = "MERGEABLE",
  autoMergeRequest = null,
}: {
  number?: number;
  title?: string;
  state?: "OPEN" | "CLOSED" | "MERGED";
  reviewDecision?: string | null;
  authorLogin?: string;
  authorName?: string | null;
  statusNodes?: unknown[];
  additions?: number;
  deletions?: number;
  mergeable?: string;
  autoMergeRequest?: { enabledBy: { login: string }; mergeMethod: string } | null;
} = {}): object {
  return {
    number,
    title,
    state,
    author: {
      __typename: "User",
      login: authorLogin,
      name: authorName,
    },
    headRefName: "feature/unlimited",
    baseRefName: "main",
    reviewDecision,
    updatedAt: "2026-03-20T00:00:00Z",
    url: `https://github.com/octo/dispatch/pull/${number}`,
    isDraft: false,
    statusCheckRollup: {
      contexts: {
        nodes: statusNodes,
      },
    },
    additions,
    deletions,
    mergeable,
    autoMergeRequest,
  };
}

function createGraphqlPullRequestConnectionStdout({
  kind,
  nodes,
  hasNextPage = false,
  endCursor = null,
}: {
  kind: "repository" | "search";
  nodes: object[];
  hasNextPage?: boolean;
  endCursor?: string | null;
}): string {
  if (kind === "repository") {
    return JSON.stringify({
      data: {
        repository: {
          pullRequests: {
            nodes,
            pageInfo: {
              hasNextPage,
              endCursor,
            },
          },
        },
      },
    });
  }

  return JSON.stringify({
    data: {
      search: {
        nodes,
        pageInfo: {
          hasNextPage,
          endCursor,
        },
      },
    },
  });
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
    execFileMock.mockReset();
    getPrCacheMock.mockReset();
    getPrCacheMock.mockReturnValue(null);
    getPrListCacheMock.mockReset();
    getPrListCacheMock.mockReturnValue(null);
    getPreferenceMock.mockReset();
    getPreferenceMock.mockReturnValue(null);
    invalidatePersistedPrCachesMock.mockReset();
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
      .mockResolvedValueOnce({ stdout: createPrListStdout("After edit"), stderr: "" });

    await expect(listPrsCore("/repo-title", "all")).resolves.toMatchObject([
      { title: "Before edit" },
    ]);

    await updatePrTitle("/repo-title", 42, "After edit");
    expect(invalidatePersistedPrCachesMock).toHaveBeenCalledWith("/repo-title", 42);

    await expect(listPrsCore("/repo-title", "all")).resolves.toMatchObject([
      { title: "After edit" },
    ]);
    expect(execFileMock).toHaveBeenCalledTimes(5);
  });

  it("uses persisted terminal PR core lists without shell calls", async () => {
    getPrListCacheMock.mockReturnValueOnce({
      data: [
        {
          additions: 24,
          author: { login: "octocat", name: "The Octocat" },
          baseRefName: "main",
          deletions: 8,
          headRefName: "feature/cache",
          isDraft: false,
          number: 42,
          reviewDecision: "REVIEW_REQUIRED",
          state: "CLOSED",
          title: "Persisted closed PR",
          updatedAt: "2026-03-20T00:00:00Z",
          url: "https://github.com/octo/dispatch/pull/42",
        },
      ],
      fetchedAt: "3026-03-20T00:00:00Z",
    } as ReturnType<typeof getPrListCache>);

    await expect(listPrsCore("/repo-persisted-core", "all", "closed")).resolves.toMatchObject([
      { title: "Persisted closed PR" },
    ]);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("ignores stale persisted terminal PR core lists", async () => {
    getPrListCacheMock.mockReturnValueOnce({
      data: [
        {
          additions: 24,
          author: { login: "octocat", name: "The Octocat" },
          baseRefName: "main",
          deletions: 8,
          headRefName: "feature/cache",
          isDraft: false,
          number: 42,
          reviewDecision: "REVIEW_REQUIRED",
          state: "CLOSED",
          title: "Stale closed PR",
          updatedAt: "2026-03-20T00:00:00Z",
          url: "https://github.com/octo/dispatch/pull/42",
        },
      ],
      fetchedAt: "2000-03-20T00:00:00Z",
    } as ReturnType<typeof getPrListCache>);

    execFileMock
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({ stdout: createPrListStdout("Fresh closed PR"), stderr: "" });

    await expect(listPrsCore("/repo-stale-core", "all", "closed")).resolves.toMatchObject([
      { title: "Fresh closed PR" },
    ]);
    expect(execFileMock).toHaveBeenCalledTimes(3);
  });

  it("bypasses persisted terminal PR core lists when a forced refresh is requested", async () => {
    getPrListCacheMock.mockReturnValueOnce({
      data: [
        {
          additions: 24,
          author: { login: "octocat", name: "The Octocat" },
          baseRefName: "main",
          deletions: 8,
          headRefName: "feature/cache",
          isDraft: false,
          number: 42,
          reviewDecision: "REVIEW_REQUIRED",
          state: "CLOSED",
          title: "Persisted closed PR",
          updatedAt: "2026-03-20T00:00:00Z",
          url: "https://github.com/octo/dispatch/pull/42",
        },
      ],
      fetchedAt: "3026-03-20T00:00:00Z",
    } as ReturnType<typeof getPrListCache>);

    execFileMock
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({ stdout: createPrListStdout("Fresh closed PR"), stderr: "" });

    await expect(
      listPrsCore("/repo-persisted-core-force", "all", "closed", true),
    ).resolves.toMatchObject([{ title: "Fresh closed PR" }]);
    expect(getPrListCacheMock).not.toHaveBeenCalled();
    expect(execFileMock).toHaveBeenCalledTimes(3);
  });

  it("uses persisted terminal PR enrichment without shell calls", async () => {
    getPrListCacheMock.mockReturnValueOnce({
      data: [
        {
          additions: 24,
          autoMergeRequest: null,
          deletions: 8,
          mergeable: "MERGEABLE",
          number: 42,
          statusCheckRollup: [{ conclusion: "SUCCESS", name: "CI", status: "COMPLETED" }],
        },
      ],
      fetchedAt: "3026-03-20T00:00:00Z",
    } as ReturnType<typeof getPrListCache>);

    await expect(
      listPrsEnrichment("/repo-persisted-enrichment", "all", "closed"),
    ).resolves.toMatchObject([{ mergeable: "MERGEABLE" }]);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("bypasses persisted terminal PR enrichment when a forced refresh is requested", async () => {
    getPrListCacheMock.mockReturnValueOnce({
      data: [
        {
          additions: 24,
          autoMergeRequest: null,
          deletions: 8,
          mergeable: "UNKNOWN",
          number: 42,
          statusCheckRollup: [],
        },
      ],
      fetchedAt: "3026-03-20T00:00:00Z",
    } as ReturnType<typeof getPrListCache>);

    execFileMock
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({ stdout: createPrEnrichmentStdout(), stderr: "" });

    await expect(
      listPrsEnrichment("/repo-persisted-enrichment-force", "all", "closed", true),
    ).resolves.toMatchObject([{ mergeable: "MERGEABLE" }]);
    expect(getPrListCacheMock).not.toHaveBeenCalled();
    expect(execFileMock).toHaveBeenCalledTimes(3);
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

  it("paginates repository pull request queries when the fetch limit is unlimited", async () => {
    getPreferenceMock.mockImplementation((key) => (key === "prFetchLimit" ? "all" : null));

    execFileMock
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({
        stdout: createGraphqlPullRequestConnectionStdout({
          kind: "repository",
          nodes: [createGraphqlPullRequestNode({ number: 42, title: "First page" })],
          hasNextPage: true,
          endCursor: "cursor-2",
        }),
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: createGraphqlPullRequestConnectionStdout({
          kind: "repository",
          nodes: [createGraphqlPullRequestNode({ number: 84, title: "Second page" })],
        }),
        stderr: "",
      });

    await expect(listPrsCore("/repo-unlimited", "all", "all")).resolves.toMatchObject([
      { number: 42, title: "First page" },
      { number: 84, title: "Second page" },
    ]);

    const firstUnlimitedCallArgs = execFileMock.mock.calls[2]?.[1] as string[];
    const secondUnlimitedCallArgs = execFileMock.mock.calls[3]?.[1] as string[];

    expect(firstUnlimitedCallArgs).toEqual(
      expect.arrayContaining(["api", "graphql", "-f", "owner=octo", "-f", "repo=dispatch"]),
    );
    expect(
      firstUnlimitedCallArgs.some((arg) => arg.includes("pullRequests(first: 100")),
    ).toBeTruthy();
    expect(firstUnlimitedCallArgs.some((arg) => arg.includes("statusCheckRollup"))).toBeFalsy();
    expect(firstUnlimitedCallArgs.some((arg) => arg.includes("autoMergeRequest"))).toBeFalsy();
    expect(firstUnlimitedCallArgs.includes("--limit")).toBeFalsy();
    expect(secondUnlimitedCallArgs).toEqual(expect.arrayContaining(["-f", "after=cursor-2"]));
  });

  it("creates left-side review comments for deleted lines", async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: "OPEN\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "abc123def456\n", stderr: "" })
      .mockRejectedValueOnce(new Error("repo view unavailable"))
      .mockResolvedValueOnce({ stdout: "", stderr: "" });

    await createReviewComment({
      cwd: "/repo-comments",
      owner: "test-owner",
      repo: "test-repo",
      prNumber: 42,
      body: "Comment on removed code",
      path: "src/removed.ts",
      line: 18,
      side: "LEFT",
    });

    expect(execFileMock).toHaveBeenNthCalledWith(
      4,
      "gh",
      expect.arrayContaining([
        "api",
        "repos/test-owner/test-repo/pulls/42/comments",
        "-X",
        "POST",
        "-f",
        "body=Comment on removed code",
        "-f",
        "path=src/removed.ts",
        "-F",
        "line=18",
        "-f",
        "side=LEFT",
      ]),
      expect.anything(),
    );
  });

  it("rejects review submission for merged pull requests before invoking gh review", async () => {
    execFileMock.mockResolvedValueOnce({ stdout: "MERGED\n", stderr: "" });

    await expect(
      submitReview({
        cwd: "/repo-comments",
        owner: "test-owner",
        repo: "test-repo",
        prNumber: 42,
        event: "APPROVE",
      }),
    ).rejects.toThrow("Review actions are unavailable for closed or merged pull requests.");

    expect(execFileMock.mock.calls).toHaveLength(1);
    expect(execFileMock).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["pr", "view", "42", "--json", "state", "--jq", ".state"]),
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

  it("uses slim GraphQL search fields for unlimited filtered core pull request queries", async () => {
    getPreferenceMock.mockImplementation((key) => (key === "prFetchLimit" ? "all" : null));

    execFileMock
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({
        stdout: createGraphqlPullRequestConnectionStdout({
          kind: "search",
          nodes: [
            createGraphqlPullRequestNode({
              number: 77,
              title: "Authored unlimited",
              statusNodes: [
                { __typename: "StatusContext", context: "lint", state: "PENDING" },
                {
                  __typename: "CheckRun",
                  name: "CI",
                  status: "COMPLETED",
                  conclusion: "SUCCESS",
                },
              ],
              autoMergeRequest: {
                enabledBy: { login: "octocat" },
                mergeMethod: "SQUASH",
              },
            }),
          ],
        }),
        stderr: "",
      });

    await expect(listPrsCore("/repo-unlimited-authored", "authored")).resolves.toMatchObject([
      {
        number: 77,
        title: "Authored unlimited",
        additions: 24,
        deletions: 8,
      },
    ]);

    const unlimitedSearchCallArgs = execFileMock.mock.calls[2]?.[1] as string[];

    expect(unlimitedSearchCallArgs).toEqual(expect.arrayContaining(["api", "graphql"]));
    expect(
      unlimitedSearchCallArgs.some((arg) =>
        arg.includes("searchQuery=repo:octo/dispatch is:pr sort:updated-desc is:open author:@me"),
      ),
    ).toBeTruthy();
    expect(unlimitedSearchCallArgs.some((arg) => arg.includes("statusCheckRollup"))).toBeFalsy();
    expect(unlimitedSearchCallArgs.some((arg) => arg.includes("autoMergeRequest"))).toBeFalsy();
    expect(unlimitedSearchCallArgs.includes("--limit")).toBeFalsy();
  });

  it("uses full GraphQL search fields for unlimited enrichment pull request queries", async () => {
    getPreferenceMock.mockImplementation((key) => (key === "prFetchLimit" ? "all" : null));

    execFileMock
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({
        stdout: createGraphqlPullRequestConnectionStdout({
          kind: "search",
          nodes: [
            createGraphqlPullRequestNode({
              number: 77,
              title: "Authored unlimited",
              statusNodes: [
                { __typename: "StatusContext", context: "lint", state: "PENDING" },
                {
                  __typename: "CheckRun",
                  name: "CI",
                  status: "COMPLETED",
                  conclusion: "SUCCESS",
                },
              ],
              autoMergeRequest: {
                enabledBy: { login: "octocat" },
                mergeMethod: "SQUASH",
              },
            }),
          ],
        }),
        stderr: "",
      });

    await expect(listPrsEnrichment("/repo-unlimited-authored", "authored")).resolves.toMatchObject([
      {
        number: 77,
        statusCheckRollup: [
          { name: "lint", status: "PENDING", conclusion: null },
          { name: "CI", status: "COMPLETED", conclusion: "SUCCESS" },
        ],
        autoMergeRequest: {
          enabledBy: { login: "octocat" },
          mergeMethod: "SQUASH",
        },
      },
    ]);

    const unlimitedSearchCallArgs = execFileMock.mock.calls[2]?.[1] as string[];

    expect(unlimitedSearchCallArgs.some((arg) => arg.includes("statusCheckRollup"))).toBeTruthy();
    expect(unlimitedSearchCallArgs.some((arg) => arg.includes("autoMergeRequest"))).toBeTruthy();
  });

  it("raises gh api graphql calls to a higher timeout floor", async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [],
                },
              },
            },
          },
        }),
        stderr: "",
      });

    await expect(getPrReviewThreads("/repo-review-threads", 42)).resolves.toEqual([]);

    expect(execFileMock).toHaveBeenNthCalledWith(
      3,
      "gh",
      expect.arrayContaining(["api", "graphql"]),
      expect.objectContaining({ timeout: 120_000 }),
    );
  });

  it("bypasses the cached PR list when a forced refresh is requested", async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({ stdout: createPrListStdout("Cached"), stderr: "" })
      .mockResolvedValueOnce({ stdout: createPrListStdout("Fresh"), stderr: "" });

    await expect(listPrsCore("/repo-force-refresh", "all")).resolves.toMatchObject([
      { title: "Cached" },
    ]);

    await expect(listPrsCore("/repo-force-refresh", "all", "open", true)).resolves.toMatchObject([
      { title: "Fresh" },
    ]);

    expect(execFileMock).toHaveBeenCalledTimes(4);
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

  it("falls back to the paginated PR files API when pr diff hits the file limit", async () => {
    execFileMock
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            "Sorry, the diff exceeded the maximum number of files (300). Consider using 'List pull requests files' API.",
          ),
          { stderr: "", stdout: "" },
        ),
      )
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({ stdout: createPullRequestFilesStdout(2), stderr: "" });

    const diff = await getPrDiff("/repo-large-diff", 42);

    expect(diff).toContain("diff --git a/src/file-1.ts b/src/file-1.ts");
    expect(diff).toContain("@@ -1 +1 @@");
    expect(execFileMock).toHaveBeenNthCalledWith(1, "gh", ["pr", "diff", "42"], expect.anything());
    expect(execFileMock).toHaveBeenNthCalledWith(
      4,
      "gh",
      ["api", "repos/octo/dispatch/pulls/42/files?per_page=100&page=1"],
      expect.anything(),
    );
  });

  it("keeps patchless files in the fallback diff manifest", async () => {
    execFileMock
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            "Sorry, the diff exceeded the maximum number of files (300). Consider using 'List pull requests files' API.",
          ),
          { stderr: "", stdout: "" },
        ),
      )
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            filename: "data/example.parquet",
            status: "modified",
            additions: 0,
            deletions: 0,
          },
        ]),
        stderr: "",
      });

    const diff = await getPrDiff("/repo-large-diff", 42);

    expect(diff).toContain("diff --git a/data/example.parquet b/data/example.parquet");
    expect(diff).toContain("--- a/data/example.parquet");
    expect(diff).toContain("+++ b/data/example.parquet");
    expect(diff).toContain("dispatch-stats additions=0 deletions=0");
  });

  it("backfills truncated PR file manifests from the paginated PR files API", async () => {
    execFileMock
      .mockResolvedValueOnce({
        stdout: createPrDetailStdout({
          changedFiles: 101,
          files: [{ path: "src/file-1.ts", additions: 2, deletions: 1 }],
        }),
        stderr: "",
      })
      .mockResolvedValueOnce({ stdout: createRepoInfoStdout(), stderr: "" })
      .mockRejectedValueOnce(new Error("merge queue unavailable"))
      .mockResolvedValueOnce({ stdout: createPullRequestFilesStdout(100, 1), stderr: "" })
      .mockResolvedValueOnce({ stdout: createPullRequestFilesStdout(1, 101), stderr: "" });

    const detail = await getPrDetail("/repo-large-detail", 42);

    expect(detail.files).toHaveLength(101);
    expect(detail.files).toEqual(
      expect.arrayContaining([
        { path: "src/file-1.ts", additions: 2, deletions: 1 },
        { path: "src/file-101.ts", additions: 2, deletions: 1 },
      ]),
    );
    expect(execFileMock).toHaveBeenNthCalledWith(
      4,
      "gh",
      ["api", "repos/octo/dispatch/pulls/42/files?per_page=100&page=1"],
      expect.anything(),
    );
    expect(execFileMock).toHaveBeenNthCalledWith(
      5,
      "gh",
      ["api", "repos/octo/dispatch/pulls/42/files?per_page=100&page=2"],
      expect.anything(),
    );
  });

  it("uses persisted terminal PR detail without shell calls", async () => {
    getPrCacheMock.mockReturnValueOnce({
      detail: JSON.parse(createPrDetailStdout({ state: "MERGED", title: "Persisted merged PR" })),
      fetchedAt: "3026-03-20T00:00:00Z",
      listItem: null,
      prNumber: 42,
      repo: "/repo-persisted-detail",
      state: "MERGED",
      updatedAt: "2026-03-20T00:05:00Z",
    });

    await expect(getPrDetail("/repo-persisted-detail", 42)).resolves.toMatchObject({
      title: "Persisted merged PR",
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("ignores stale persisted terminal PR detail", async () => {
    getPrCacheMock.mockReturnValueOnce({
      detail: JSON.parse(createPrDetailStdout({ state: "MERGED", title: "Stale merged PR" })),
      fetchedAt: "2000-03-20T00:00:00Z",
      listItem: null,
      prNumber: 42,
      repo: "/repo-stale-detail",
      state: "MERGED",
      updatedAt: "2026-03-20T00:05:00Z",
    });

    execFileMock.mockResolvedValueOnce({
      stdout: createPrDetailStdout({ state: "MERGED", title: "Fresh merged PR" }),
      stderr: "",
    });

    await expect(getPrDetail("/repo-stale-detail", 42)).resolves.toMatchObject({
      title: "Fresh merged PR",
    });
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("ignores persisted detail for open pull requests", async () => {
    getPrCacheMock.mockReturnValueOnce({
      detail: JSON.parse(createPrDetailStdout({ state: "OPEN", title: "Cached open PR" })),
      fetchedAt: "3026-03-20T00:00:00Z",
      listItem: null,
      prNumber: 42,
      repo: "/repo-open-detail",
      state: "OPEN",
      updatedAt: "2026-03-20T00:05:00Z",
    });

    execFileMock.mockResolvedValueOnce({
      stdout: createPrDetailStdout({ state: "OPEN", title: "Fresh open PR" }),
      stderr: "",
    });

    await expect(getPrDetail("/repo-open-detail", 42)).resolves.toMatchObject({
      title: "Fresh open PR",
    });
    expect(execFileMock).toHaveBeenCalledTimes(1);
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

  it("returns both node and database IDs for pull request conversation comments", async () => {
    execFileMock.mockRejectedValueOnce(new Error("repo view unavailable")).mockResolvedValueOnce({
      stdout: JSON.stringify([
        {
          node_id: "IC_kwDOexample",
          id: 456,
          body: "Please also update the fixture.",
          user: { login: "octocat" },
          created_at: "2026-03-20T00:00:00Z",
        },
      ]),
      stderr: "",
    });

    await expect(
      getIssueComments({ cwd: "/repo-comments", owner: "octo", repo: "dispatch" }, 42),
    ).resolves.toEqual([
      {
        nodeId: "IC_kwDOexample",
        databaseId: 456,
        body: "Please also update the fixture.",
        author: { login: "octocat" },
        createdAt: "2026-03-20T00:00:00Z",
      },
    ]);

    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      "gh",
      ["api", "repos/octo/dispatch/issues/42/comments?per_page=100", "--paginate"],
      expect.anything(),
    );
  });
});
