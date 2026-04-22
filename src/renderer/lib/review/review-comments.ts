import {
  getReviewPositionKey,
  type ReviewPositionSide,
} from "@/renderer/lib/review/review-position";

interface PositionedReviewComment {
  path: string;
  line: number | null;
  original_line: number | null;
  side: ReviewPositionSide;
}

interface ReviewThreadWithRootComment {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  rootCommentId: number | null;
}

export interface ReviewThreadState {
  isResolved: boolean;
  isOutdated: boolean;
  threadId: string;
}

export function buildReviewCommentsMap<T extends PositionedReviewComment>(
  comments: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();

  for (const comment of comments) {
    const line = comment.line ?? comment.original_line;
    if (line !== null) {
      const key = getReviewPositionKey(comment.path, line, comment.side);
      const existing = map.get(key);
      if (existing) {
        existing.push(comment);
      } else {
        map.set(key, [comment]);
      }
    }
  }

  return map;
}

export function buildReviewThreadStateByRootCommentId<T extends ReviewThreadWithRootComment>(
  reviewThreads: T[],
): Map<number, ReviewThreadState> {
  const map = new Map<number, ReviewThreadState>();

  for (const thread of reviewThreads) {
    if (thread.rootCommentId !== null) {
      map.set(thread.rootCommentId, {
        isResolved: thread.isResolved,
        isOutdated: thread.isOutdated,
        threadId: thread.id,
      });
    }
  }

  return map;
}
