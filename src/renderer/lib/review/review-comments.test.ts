import {
  buildReviewCommentsMap,
  buildReviewThreadStateByRootCommentId,
} from "@/renderer/lib/review/review-comments";
import { describe, expect, it } from "vite-plus/test";

describe("buildReviewCommentsMap", () => {
  it("falls back to original_line when the current line is unavailable", () => {
    const comment = {
      id: 101,
      path: "src/review/example.ts",
      side: "RIGHT" as const,
      line: null,
      original_line: 27,
    };

    const commentsByLine = buildReviewCommentsMap([comment]);

    expect(commentsByLine.get("src/review/example.ts:RIGHT:27")).toEqual([comment]);
  });

  it("keeps left and right review comments on separate keys", () => {
    const leftComment = {
      id: 102,
      path: "src/review/example.ts",
      side: "LEFT" as const,
      line: 14,
      original_line: 14,
    };
    const rightComment = {
      id: 103,
      path: "src/review/example.ts",
      side: "RIGHT" as const,
      line: 14,
      original_line: 14,
    };

    const commentsByLine = buildReviewCommentsMap([leftComment, rightComment]);

    expect(commentsByLine.get("src/review/example.ts:LEFT:14")).toEqual([leftComment]);
    expect(commentsByLine.get("src/review/example.ts:RIGHT:14")).toEqual([rightComment]);
  });
});

describe("buildReviewThreadStateByRootCommentId", () => {
  it("indexes thread resolution metadata by the root review comment id", () => {
    const reviewThreadStateByRootCommentId = buildReviewThreadStateByRootCommentId([
      {
        id: "thread-1",
        isResolved: true,
        isOutdated: false,
        rootCommentId: 501,
      },
      {
        id: "thread-2",
        isResolved: false,
        isOutdated: true,
        rootCommentId: 502,
      },
    ]);

    expect(reviewThreadStateByRootCommentId.get(501)).toEqual({
      isResolved: true,
      isOutdated: false,
      threadId: "thread-1",
    });
    expect(reviewThreadStateByRootCommentId.get(502)).toEqual({
      isResolved: false,
      isOutdated: true,
      threadId: "thread-2",
    });
  });
});
