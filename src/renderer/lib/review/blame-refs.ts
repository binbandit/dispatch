import type { ReviewDiffMode, ReviewResumeSelectedCommit } from "@/shared/ipc/contracts/review";

export interface DiffBlameRefs {
  oldLineRef: string | null;
  newLineRef: string;
}

interface ResolveDiffBlameRefsArgs {
  diffMode: ReviewDiffMode;
  selectedCommit: ReviewResumeSelectedCommit | null;
  lastReviewedSha: string | null;
  headSha: string;
  baseRefName: string | null;
  mergeBaseSha: string | null;
}

export function resolveDiffBlameRefs({
  diffMode,
  selectedCommit,
  lastReviewedSha,
  headSha,
  baseRefName,
  mergeBaseSha,
}: ResolveDiffBlameRefsArgs): DiffBlameRefs {
  if (selectedCommit) {
    return {
      oldLineRef: `${selectedCommit.oid}^1`,
      newLineRef: selectedCommit.oid,
    };
  }

  if (diffMode === "since-review" && lastReviewedSha && lastReviewedSha !== headSha) {
    return {
      oldLineRef: lastReviewedSha,
      newLineRef: headSha,
    };
  }

  return {
    oldLineRef: mergeBaseSha ?? baseRefName,
    newLineRef: "HEAD",
  };
}
