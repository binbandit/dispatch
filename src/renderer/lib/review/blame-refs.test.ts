import { describe, expect, it } from "vite-plus/test";

import { resolveDiffBlameRefs } from "./blame-refs";

describe("resolveDiffBlameRefs", () => {
  it("uses the selected commit and its first parent in commit view", () => {
    expect(
      resolveDiffBlameRefs({
        diffMode: "all",
        selectedCommit: {
          oid: "abc123",
          message: "Fix the thing",
        },
        lastReviewedSha: "reviewed",
        headSha: "headsha",
        baseRefName: "main",
        mergeBaseSha: "mergebase",
      }),
    ).toEqual({
      oldLineRef: "abc123^1",
      newLineRef: "abc123",
    });
  });

  it("uses the last reviewed sha for incremental diffs", () => {
    expect(
      resolveDiffBlameRefs({
        diffMode: "since-review",
        selectedCommit: null,
        lastReviewedSha: "reviewed",
        headSha: "headsha",
        baseRefName: "main",
        mergeBaseSha: "mergebase",
      }),
    ).toEqual({
      oldLineRef: "reviewed",
      newLineRef: "headsha",
    });
  });

  it("falls back to the merge-base for full PR diffs", () => {
    expect(
      resolveDiffBlameRefs({
        diffMode: "all",
        selectedCommit: null,
        lastReviewedSha: "reviewed",
        headSha: "headsha",
        baseRefName: "main",
        mergeBaseSha: "mergebase",
      }),
    ).toEqual({
      oldLineRef: "mergebase",
      newLineRef: "HEAD",
    });
  });

  it("falls back to the base ref when the merge-base is unavailable", () => {
    expect(
      resolveDiffBlameRefs({
        diffMode: "all",
        selectedCommit: null,
        lastReviewedSha: null,
        headSha: "headsha",
        baseRefName: "main",
        mergeBaseSha: null,
      }),
    ).toEqual({
      oldLineRef: "main",
      newLineRef: "HEAD",
    });
  });

  it("treats a completed since-review range as a full PR diff", () => {
    expect(
      resolveDiffBlameRefs({
        diffMode: "since-review",
        selectedCommit: null,
        lastReviewedSha: "headsha",
        headSha: "headsha",
        baseRefName: "main",
        mergeBaseSha: "mergebase",
      }),
    ).toEqual({
      oldLineRef: "mergebase",
      newLineRef: "HEAD",
    });
  });
});
