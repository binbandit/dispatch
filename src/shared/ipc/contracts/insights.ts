import type { GhPrEnrichment, GhPrListItemCore, RepoTarget } from "../../ipc";

export interface InsightsIpcApi {
  "pr.listAll": {
    args: {
      filter: "reviewRequested" | "authored" | "all";
      state?: "open" | "closed" | "merged" | "all";
    };
    result: Array<
      GhPrListItemCore & {
        workspace: string;
        workspacePath: string | null;
        repository: string;
        pullRequestRepository: string;
        isForkWorkspace: boolean;
      }
    >;
  };
  "pr.listAllEnrichment": {
    args: {
      filter: "reviewRequested" | "authored" | "all";
      state?: "open" | "closed" | "merged" | "all";
    };
    result: Array<
      GhPrEnrichment & {
        workspacePath: string | null;
        repository: string;
        pullRequestRepository: string;
        isForkWorkspace: boolean;
      }
    >;
  };
  "metrics.prCycleTime": {
    args: RepoTarget & { since: string };
    result: Array<{
      prNumber: number;
      title: string;
      author: string;
      createdAt: string;
      mergedAt: string | null;
      firstReviewAt: string | null;
      timeToFirstReview: number | null;
      timeToMerge: number | null;
      additions: number;
      deletions: number;
    }>;
  };
  "metrics.reviewLoad": {
    args: RepoTarget & { since: string };
    result: Array<{
      reviewer: string;
      reviewCount: number;
      avgResponseTime: number;
    }>;
  };
  "releases.list": {
    args: RepoTarget & { limit?: number };
    result: Array<{
      tagName: string;
      name: string;
      body: string;
      isDraft: boolean;
      isPrerelease: boolean;
      createdAt: string;
      author: { login: string };
    }>;
  };
  "releases.create": {
    args: RepoTarget & {
      tagName: string;
      name: string;
      body: string;
      isDraft: boolean;
      isPrerelease: boolean;
      target: string;
    };
    result: { url: string };
  };
  "releases.generateChangelog": {
    args: RepoTarget & { sinceTag: string };
    result: string;
  };
}
