import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../shared/pr-fetch-limit", () => ({
  PR_FETCH_LIMIT_PREFERENCE_KEY: "prFetchLimit",
  normalizePrFetchLimit: vi.fn(() => "200"),
}));

vi.mock("../../db/repository", () => ({
  getPreference: vi.fn(() => null),
  cacheDisplayNames: vi.fn(),
}));

vi.mock("../shell", () => ({
  execFile: vi.fn(),
  resolveExecutablePath: vi.fn(),
}));

import {
  buildFilterArgs,
  cacheKey,
  genericCache,
  getOrLoadCached,
  invalidateAllCaches,
  invalidateCacheKey,
  invalidatePrListCaches,
  parseJsonOutput,
  setCache,
} from "./core";

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
    const output = '[1, 2][3, 4]';
    const result = parseJsonOutput<number[]>(output);
    expect(result).toEqual([1, 2, 3, 4]);
  });

  it("handles nested arrays in fallback mode", () => {
    const output = '[[1, 2], [3, 4]]';
    const result = parseJsonOutput<number[][]>(output);
    expect(result).toEqual([[1, 2], [3, 4]]);
  });

  it("handles JSON with surrounding whitespace", () => {
    const result = parseJsonOutput<string[]>('  ["a", "b"]  ');
    expect(result).toEqual(["a", "b"]);
  });
});

describe("cacheKey", () => {
  it("builds key from nwo, filter, state, limit", () => {
    const key = cacheKey({ nwo: "owner/repo", filter: "reviewRequested", state: "open", limit: "100" });
    expect(key).toBe("owner/repo::reviewRequested::open::100");
  });

  it("prefers nwo over cwd", () => {
    const key = cacheKey({ nwo: "owner/repo", cwd: "/local/path", filter: "all", state: "open", limit: "50" });
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
  // Use the exported genericCache (typed as unknown) for testing cache mechanics.
  // Prefix test keys to avoid cross-test pollution.
  const testKey = (suffix: string) => `__test__::${suffix}::${Date.now()}`;

  it("stores and retrieves cached data", () => {
    const key = testKey("store");
    setCache(genericCache, key, { data: "value1" });

    const result = getOrLoadCached({
      cache: genericCache,
      key,
      loader: async () => "should not be called",
    });
    return expect(result).resolves.toBe("value1");
  });

  it("calls loader when cache misses", async () => {
    const key = testKey("miss");
    const result = await getOrLoadCached({
      cache: genericCache,
      key,
      loader: async () => "loaded",
    });
    expect(result).toBe("loaded");
  });

  it("invalidates cache key", async () => {
    const key = testKey("invalidate");
    setCache(genericCache, key, { data: "value1" });
    invalidateCacheKey(genericCache, key);

    const loader = vi.fn(async () => "fresh");
    const result = await getOrLoadCached({ cache: genericCache, key, loader });
    expect(loader).toHaveBeenCalled();
    expect(result).toBe("fresh");
  });

  it("deduplicates in-flight requests", async () => {
    const key = testKey("dedup");
    let callCount = 0;
    const loader = async () => {
      callCount++;
      return "result";
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
      loader: async () => {
        invalidateCacheKey(genericCache, key);
        return "stale";
      },
    });

    expect(result).toBe("stale");
    const loader2 = vi.fn(async () => "fresh");
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
