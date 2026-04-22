import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCachedUserProfile, getStaleUserProfile, saveUserProfile } from "../../db/repository";
import { execFile } from "../shell";
import {
  buildFilterArgs,
  cacheKey,
  genericCache,
  getUserProfile,
  getOrLoadCached,
  invalidateAllCaches,
  invalidateCacheKey,
  invalidatePrListCaches,
  parseJsonOutput,
  setCache,
} from "./core";

vi.mock(import("../../../shared/pr-fetch-limit"), () => ({
  PR_FETCH_LIMIT_PREFERENCE_KEY: "prFetchLimit" as const,
  normalizePrFetchLimit: vi.fn<(value?: string | null) => 200>(
    (_value?: string | null) => 200 as const,
  ),
}));

vi.mock(import("../../db/repository"), () => ({
  getPreference: vi.fn<(key: string) => string | null>(() => null),
  cacheDisplayNames: vi.fn<(...args: unknown[]) => void>(),
  getCachedUserProfile: vi.fn<typeof getCachedUserProfile>(() => null),
  getStaleUserProfile: vi.fn<typeof getStaleUserProfile>(() => null),
  saveUserProfile: vi.fn<typeof saveUserProfile>(),
}));

vi.mock(import("../shell"), () => ({
  execFile: vi.fn<typeof execFile>(),
  resolveExecutablePath: vi.fn<(command: string) => string | null>(),
}));

const execFileMock = vi.mocked(execFile);
const getCachedUserProfileMock = vi.mocked(getCachedUserProfile);
const getStaleUserProfileMock = vi.mocked(getStaleUserProfile);
const saveUserProfileMock = vi.mocked(saveUserProfile);
const testKey = (suffix: string): string => `__test__::${suffix}::${Date.now()}`;

beforeEach(() => {
  vi.clearAllMocks();
  invalidateAllCaches();
  getCachedUserProfileMock.mockReturnValue(null);
  getStaleUserProfileMock.mockReturnValue(null);
});

describe("parseJsonOutput", () => {
  it("parses valid JSON array", () => {
    const result = parseJsonOutput<number[]>("[1, 2, 3]");
    expect(result).toEqual([1, 2, 3]);
  });

  it("parses valid JSON object", () => {
    const result = parseJsonOutput<{ name: string }>(JSON.stringify({ name: "test" }));
    expect(result).toEqual({ name: "test" });
  });

  it("returns empty array for empty string", () => {
    expect(parseJsonOutput("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(parseJsonOutput("   ")).toEqual([]);
  });

  it("concatenates multiple JSON arrays when standard parse fails", () => {
    const output = "[1, 2][3, 4]";
    const result = parseJsonOutput<number[]>(output);
    expect(result).toEqual([1, 2, 3, 4]);
  });

  it("handles nested arrays in fallback mode", () => {
    const output = "[[1, 2], [3, 4]]";
    const result = parseJsonOutput<number[][]>(output);
    expect(result).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("handles JSON with surrounding whitespace", () => {
    const result = parseJsonOutput<string[]>('  ["a", "b"]  ');
    expect(result).toEqual(["a", "b"]);
  });
});

describe("cacheKey", () => {
  it("builds key from nwo, filter, state, limit", () => {
    const key = cacheKey({
      nwo: "owner/repo",
      filter: "reviewRequested",
      state: "open",
      limit: "100",
    });
    expect(key).toBe("owner/repo::reviewRequested::open::100");
  });

  it("prefers nwo over cwd", () => {
    const key = cacheKey({
      nwo: "owner/repo",
      cwd: "/local/path",
      filter: "all",
      state: "open",
      limit: "50",
    });
    expect(key).toBe("owner/repo::all::open::50");
  });

  it("falls back to cwd when nwo not provided", () => {
    const key = cacheKey({ cwd: "/local/path", filter: "authored", state: "closed", limit: "25" });
    expect(key).toBe("/local/path::authored::closed::25");
  });

  it("uses 'unknown' when neither nwo nor cwd provided", () => {
    const key = cacheKey({ filter: "all", state: "open", limit: "200" });
    expect(key).toBe("unknown::all::open::200");
  });

  it("defaults state to open", () => {
    const key = cacheKey({ nwo: "o/r", filter: "all", limit: "50" });
    expect(key).toBe("o/r::all::open::50");
  });
});

describe("buildFilterArgs", () => {
  it("builds reviewRequested filter args", () => {
    const args = buildFilterArgs({
      filter: "reviewRequested",
      jsonFields: "number,title",
      repoArgs: ["-R", "owner/repo"],
      state: "open",
      limit: "100",
    });
    expect(args).toContain("pr");
    expect(args).toContain("list");
    expect(args).toContain("review-requested:@me");
    expect(args).toContain("-R");
    expect(args).toContain("owner/repo");
    expect(args).toContain("number,title");
    expect(args).toContain("100");
  });

  it("builds authored filter args", () => {
    const args = buildFilterArgs({
      filter: "authored",
      jsonFields: "number,title",
      state: "open",
      limit: "50",
    });
    expect(args).toContain("--author");
    expect(args).toContain("@me");
    expect(args).not.toContain("review-requested:@me");
  });

  it("builds all filter args without --author or --search", () => {
    const args = buildFilterArgs({
      filter: "all",
      jsonFields: "number",
      state: "open",
      limit: "200",
    });
    expect(args).not.toContain("--author");
    expect(args).not.toContain("--search");
    expect(args).toContain("--state");
    expect(args).toContain("open");
  });

  it("includes custom state", () => {
    const args = buildFilterArgs({
      filter: "all",
      jsonFields: "number",
      state: "merged",
      limit: "50",
    });
    expect(args).toContain("merged");
  });

  it("defaults to empty repoArgs", () => {
    const args = buildFilterArgs({
      filter: "all",
      jsonFields: "number",
      state: "open",
      limit: "50",
    });
    expect(args).not.toContain("-R");
  });
});

describe("CacheStore operations", () => {
  it("stores and retrieves cached data", () => {
    const key = testKey("store");
    setCache(genericCache, key, { data: "value1" });

    const result = getOrLoadCached({
      cache: genericCache,
      key,
      loader: () => Promise.resolve("should not be called"),
    });
    return expect(result).resolves.toBe("value1");
  });

  it("calls loader when cache misses", async () => {
    const key = testKey("miss");
    const result = await getOrLoadCached({
      cache: genericCache,
      key,
      loader: () => Promise.resolve("loaded"),
    });
    expect(result).toBe("loaded");
  });

  it("invalidates cache key", async () => {
    const key = testKey("invalidate");
    setCache(genericCache, key, { data: "value1" });
    invalidateCacheKey(genericCache, key);

    const loader = vi.fn<() => Promise<string>>(() => Promise.resolve("fresh"));
    const result = await getOrLoadCached({ cache: genericCache, key, loader });
    expect(loader).toHaveBeenCalled();
    expect(result).toBe("fresh");
  });

  it("deduplicates in-flight requests", async () => {
    const key = testKey("dedup");
    let callCount = 0;
    const loader = () => {
      callCount++;
      return Promise.resolve("result");
    };

    const [r1, r2] = await Promise.all([
      getOrLoadCached({ cache: genericCache, key, loader }),
      getOrLoadCached({ cache: genericCache, key, loader }),
    ]);

    expect(r1).toBe("result");
    expect(r2).toBe("result");
    expect(callCount).toBe(1);
  });

  it("does not store result if cache was invalidated during load", async () => {
    const key = testKey("stale");

    const result = await getOrLoadCached({
      cache: genericCache,
      key,
      loader: () => {
        invalidateCacheKey(genericCache, key);
        return Promise.resolve("stale");
      },
    });

    expect(result).toBe("stale");
    const loader2 = vi.fn<() => Promise<string>>(() => Promise.resolve("fresh"));
    const result2 = await getOrLoadCached({ cache: genericCache, key, loader: loader2 });
    expect(loader2).toHaveBeenCalled();
    expect(result2).toBe("fresh");
  });
});

describe("invalidatePrListCaches", () => {
  it("runs without error for valid repo ID", () => {
    expect(() => invalidatePrListCaches("owner/repo")).not.toThrow();
  });
});

describe("invalidateAllCaches", () => {
  it("clears all caches without error", () => {
    expect(() => invalidateAllCaches()).not.toThrow();
  });
});

describe("getUserProfile", () => {
  it("returns persisted author profiles before hitting GitHub", async () => {
    getCachedUserProfileMock.mockReturnValue({
      profile: {
        login: "octocat",
        name: "The Octocat",
        avatarUrl: "https://example.com/octocat.png",
        bio: "Cached profile.",
        company: "@github",
        location: "San Francisco",
        followers: 120,
        following: 5,
        publicRepos: 42,
        createdAt: "2020-01-01T00:00:00Z",
        organizations: [{ login: "github", avatarUrl: "https://example.com/org.png" }],
      },
      cachedAt: "2026-04-15T00:00:00Z",
    });

    const profile = await getUserProfile("octocat");

    expect(profile).toMatchObject({
      login: "octocat",
      name: "The Octocat",
      organizations: [{ login: "github", avatarUrl: "https://example.com/org.png" }],
      repoContributions: null,
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("includes prior repository contributions when repo context is available", async () => {
    execFileMock
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          login: "octocat",
          name: "The Octocat",
          avatarUrl: "https://example.com/octocat.png",
          bio: "Testing profile history.",
          company: "@github",
          location: "San Francisco",
          followers: 120,
          following: 5,
          publicRepos: 42,
          createdAt: "2020-01-01T00:00:00Z",
        }),
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          login: "hubot",
          avatarUrl: "https://example.com/hubot.png",
          name: "Hubot",
        }),
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify([{ login: "github", avatarUrl: "https://example.com/org.png" }]),
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          data: {
            authoredPullRequests: { issueCount: 5 },
            mergedPullRequests: { issueCount: 3 },
            authoredIssues: { issueCount: 2 },
            reviewedPullRequests: { issueCount: 4 },
          },
        }),
        stderr: "",
      });

    const profile = await getUserProfile("octocat", "octo/dispatch", 42);

    expect(profile.repoContributions).toEqual({
      repo: "octo/dispatch",
      pullRequests: 4,
      mergedPullRequests: 3,
      issues: 2,
      reviewedPullRequests: 4,
      total: 9,
    });
    expect(profile.organizations).toEqual([
      { login: "github", avatarUrl: "https://example.com/org.png" },
    ]);
    expect(saveUserProfileMock).toHaveBeenCalledWith("octocat", {
      login: "octocat",
      name: "The Octocat",
      avatarUrl: "https://example.com/octocat.png",
      bio: "Testing profile history.",
      company: "@github",
      location: "San Francisco",
      followers: 120,
      following: 5,
      publicRepos: 42,
      createdAt: "2020-01-01T00:00:00Z",
      organizations: [{ login: "github", avatarUrl: "https://example.com/org.png" }],
      repoContributions: null,
    });
    expect(execFileMock).toHaveBeenCalledTimes(4);
    expect(execFileMock.mock.calls[3]?.[1]).toContain(
      "authoredPullRequestsQuery=repo:octo/dispatch is:pr author:octocat",
    );
  });

  it("uses the cached profile and contribution history on repeat lookups", async () => {
    execFileMock
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          login: "octocat",
          name: "The Octocat",
          avatarUrl: "https://example.com/octocat.png",
          bio: "Testing trust cache.",
          company: "@github",
          location: "San Francisco",
          followers: 120,
          following: 5,
          publicRepos: 42,
          createdAt: "2020-01-01T00:00:00Z",
        }),
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          login: "hubot",
          avatarUrl: "https://example.com/hubot.png",
          name: "Hubot",
        }),
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify([{ login: "github", avatarUrl: "https://example.com/org.png" }]),
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          data: {
            authoredPullRequests: { issueCount: 5 },
            mergedPullRequests: { issueCount: 3 },
            authoredIssues: { issueCount: 2 },
            reviewedPullRequests: { issueCount: 4 },
          },
        }),
        stderr: "",
      });

    const first = await getUserProfile("octocat", "octo/dispatch", 42);
    const second = await getUserProfile("octocat", "octo/dispatch", 42);

    expect(second).toEqual(first);
    expect(execFileMock).toHaveBeenCalledTimes(4);
  });

  it("falls back to stale persisted author profiles when GitHub is unavailable", async () => {
    getStaleUserProfileMock.mockReturnValue({
      profile: {
        login: "octocat",
        name: "The Octocat",
        avatarUrl: "https://example.com/octocat.png",
        bio: "Cached fallback.",
        company: "@github",
        location: "San Francisco",
        followers: 120,
        following: 5,
        publicRepos: 42,
        createdAt: "2020-01-01T00:00:00Z",
        organizations: [{ login: "github", avatarUrl: "https://example.com/org.png" }],
      },
      cachedAt: "2026-04-13T00:00:00Z",
    });
    execFileMock.mockRejectedValueOnce(new Error("network down"));

    const profile = await getUserProfile("octocat");

    expect(profile).toMatchObject({
      login: "octocat",
      bio: "Cached fallback.",
      repoContributions: null,
    });
    expect(execFileMock.mock.calls).toHaveLength(1);
  });
});
