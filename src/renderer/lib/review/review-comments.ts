import type { ReviewPositionSide } from "@/renderer/lib/review/review-position";

import { getReviewPositionKey } from "@/renderer/lib/review/review-position";

interface PositionedReviewComment {
  path: string;
  line: number | null;
  original_line: number | null;
  side: ReviewPositionSide;
}

interface ReviewThreadWithRootComment {
  id: string;
  isResolved: boolean;
  rootCommentId: number | null;
}

export interface ReviewThreadState {
  isResolved: boolean;
  threadId: string;
}

export function buildReviewCommentsMap<T extends PositionedReviewComment>(
  comments: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();

  for (const comment of comments) {
    const line = comment.line ?? comment.original_line;
    if (line === null) {
      continue;
    }

    const key = getReviewPositionKey(comment.path, line, comment.side);
    const existing = map.get(key);
    if (existing) {
      existing.push(comment);
      continue;
    }

    map.set(key, [comment]);
  }

  return map;
}

export function buildReviewThreadStateByRootCommentId<T extends ReviewThreadWithRootComment>(
  reviewThreads: T[],
): Map<number, ReviewThreadState> {
  const map = new Map<number, ReviewThreadState>();

  for (const thread of reviewThreads) {
    if (thread.rootCommentId === null) {
      continue;
    }

    map.set(thread.rootCommentId, {
      isResolved: thread.isResolved,
      threadId: thread.id,
    });
  }

  return map;
}
