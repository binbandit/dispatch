import type {
  GhAnnotation,
  GhCheckRun,
  GhPrDetail,
  GhPrEnrichment,
  GhPrListItemCore,
  GhPrReactions,
  GhReactionContent,
  GhReviewComment,
  GhReviewRequest,
  GhReviewThread,
  RepoTarget,
} from "../../ipc";

export interface PullRequestIpcApi {
  "pr.list": {
    args: RepoTarget & {
      filter: "reviewRequested" | "authored" | "all";
      state?: "open" | "closed" | "merged" | "all";
      forceRefresh?: boolean;
    };
    result: GhPrListItemCore[];
  };
  "pr.listEnrichment": {
    args: RepoTarget & {
      filter: "reviewRequested" | "authored" | "all";
      state?: "open" | "closed" | "merged" | "all";
      forceRefresh?: boolean;
    };
    result: GhPrEnrichment[];
  };
  "pr.detail": { args: RepoTarget & { prNumber: number }; result: GhPrDetail };
  "pr.commits": {
    args: RepoTarget & { prNumber: number };
    result: Array<{ oid: string; message: string; author: string; committedDate: string }>;
  };
  "pr.diff": { args: RepoTarget & { prNumber: number }; result: string };
  "pr.updateTitle": {
    args: RepoTarget & { prNumber: number; title: string };
    result: void;
  };
  "pr.updateBody": {
    args: RepoTarget & { prNumber: number; body: string };
    result: void;
  };
  "pr.repoLabels": {
    args: RepoTarget;
    result: Array<{ name: string; color: string; description: string }>;
  };
  "pr.addLabel": {
    args: RepoTarget & { prNumber: number; label: string };
    result: void;
  };
  "pr.removeLabel": {
    args: RepoTarget & { prNumber: number; label: string };
    result: void;
  };
  "pr.merge": {
    args: RepoTarget & {
      prNumber: number;
      strategy: "merge" | "squash" | "rebase";
      admin?: boolean;
      auto?: boolean;
      hasMergeQueue?: boolean;
    };
    result: { queued: boolean };
  };
  "pr.updateBranch": {
    args: RepoTarget & { prNumber: number };
    result: void;
  };
  "pr.close": {
    args: RepoTarget & { prNumber: number };
    result: void;
  };
  "pr.mergeQueueStatus": {
    args: RepoTarget & { prNumber: number };
    result: {
      inQueue: boolean;
      position: number | null;
      state: string | null;
      estimatedTimeToMerge: number | null;
    } | null;
  };
  "pr.comments": { args: RepoTarget & { prNumber: number }; result: GhReviewComment[] };
  "pr.createComment": {
    args: RepoTarget & {
      prNumber: number;
      body: string;
      path: string;
      line: number;
      side?: "LEFT" | "RIGHT";
      startLine?: number;
      startSide?: "LEFT" | "RIGHT";
    };
    result: void;
  };
  "pr.comment": { args: RepoTarget & { prNumber: number; body: string }; result: void };
  "pr.issueComments": {
    args: RepoTarget & { prNumber: number };
    result: Array<{
      id: string;
      body: string;
      author: { login: string };
      createdAt: string;
    }>;
  };
  "pr.contributors": {
    args: RepoTarget & { prNumber: number };
    result: string[];
  };
  "pr.searchUsers": {
    args: RepoTarget & { query: string };
    result: Array<{ login: string; name: string | null }>;
  };
  "pr.issuesList": {
    args: RepoTarget & { limit?: number };
    result: Array<{
      number: number;
      title: string;
      state: string;
      isPr: boolean;
    }>;
  };
  "pr.replyToComment": {
    args: RepoTarget & { prNumber: number; commentId: number; body: string };
    result: void;
  };
  "pr.reviewRequests": {
    args: RepoTarget & { prNumber: number };
    result: GhReviewRequest[];
  };
  "pr.reviewThreads": {
    args: RepoTarget & { prNumber: number };
    result: GhReviewThread[];
  };
  "pr.resolveThread": { args: RepoTarget & { threadId: string }; result: void };
  "pr.unresolveThread": { args: RepoTarget & { threadId: string }; result: void };
  "pr.submitReview": {
    args: RepoTarget & {
      prNumber: number;
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
      body?: string;
    };
    result: void;
  };
  "pr.reactions": { args: RepoTarget & { prNumber: number }; result: GhPrReactions };
  "pr.addReaction": {
    args: RepoTarget & { subjectId: string; content: GhReactionContent };
    result: void;
  };
  "pr.removeReaction": {
    args: RepoTarget & { subjectId: string; content: GhReactionContent };
    result: void;
  };

  "checks.list": { args: RepoTarget & { prNumber: number }; result: GhCheckRun[] };
  "checks.logs": { args: RepoTarget & { runId: number }; result: string };
  "checks.rerunFailed": { args: RepoTarget & { runId: number }; result: void };
  "checks.annotations": { args: RepoTarget & { prNumber: number }; result: GhAnnotation[] };
}
