import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { getDevRepoStatus, getMergeBase, parseAheadBehindCounts } from "./git-cli";
import { execFile } from "./shell";

vi.mock(import("./shell"), () => ({
  execFile: vi.fn(),
}));

const execFileMock = vi.mocked(execFile);

describe("parseAheadBehindCounts", () => {
  it("parses tab-delimited ahead/behind output", () => {
    expect(parseAheadBehindCounts("2\t5")).toEqual({
      aheadCount: 2,
      behindCount: 5,
    });
  });

  it("falls back to zero counts for invalid output", () => {
    expect(parseAheadBehindCounts("not-a-number")).toEqual({
      aheadCount: 0,
      behindCount: 0,
    });
  });
});

describe("getDevRepoStatus", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("reports when the current branch is behind its upstream", async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: "main", stderr: "" })
      .mockResolvedValueOnce({ stdout: "origin/main", stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockResolvedValueOnce({ stdout: "2\t5", stderr: "" });

    await expect(getDevRepoStatus("/repo")).resolves.toEqual({
      enabled: true,
      hasUpdates: true,
      currentBranch: "main",
      upstreamBranch: "origin/main",
      aheadCount: 2,
      behindCount: 5,
    });

    expect(execFileMock).toHaveBeenNthCalledWith(
      3,
      "git",
      ["fetch", "--quiet", "--no-tags", "--prune", "origin"],
      { cwd: "/repo", timeout: 15_000 },
    );
  });

  it("still compares against the last fetched upstream ref when fetch fails", async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: "main", stderr: "" })
      .mockResolvedValueOnce({ stdout: "origin/main", stderr: "" })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ stdout: "0\t1", stderr: "" });

    await expect(getDevRepoStatus("/repo")).resolves.toEqual({
      enabled: true,
      hasUpdates: true,
      currentBranch: "main",
      upstreamBranch: "origin/main",
      aheadCount: 0,
      behindCount: 1,
    });
  });

  it("returns a quiet state when the branch has no upstream", async () => {
    execFileMock
      .mockResolvedValueOnce({ stdout: "main", stderr: "" })
      .mockRejectedValueOnce(new Error("no upstream"));

    await expect(getDevRepoStatus("/repo")).resolves.toEqual({
      enabled: true,
      hasUpdates: false,
      currentBranch: "main",
      upstreamBranch: null,
      aheadCount: 0,
      behindCount: 0,
    });
  });
});

describe("getMergeBase", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns the merge-base sha when git resolves one", async () => {
    execFileMock.mockResolvedValueOnce({ stdout: "abc123", stderr: "" });

    await expect(getMergeBase("/repo", "main", "feature")).resolves.toBe("abc123");

    expect(execFileMock).toHaveBeenCalledWith("git", ["merge-base", "main", "feature"], {
      cwd: "/repo",
    });
  });

  it("returns null when git cannot resolve a merge-base", async () => {
    execFileMock.mockRejectedValueOnce(new Error("missing ref"));

    await expect(getMergeBase("/repo", "main", "feature")).resolves.toBeNull();
  });
});
