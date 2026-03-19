/**
 * Typed IPC API contract between main and renderer processes.
 *
 * Every IPC call goes through a single channel "dispatch:ipc".
 * The payload is { method: string, args: unknown }.
 * The response is { ok: true, data: T } | { ok: false, error: string }.
 */

export const IPC_CHANNEL = "dispatch:ipc";
export const BADGE_COUNT_CHANNEL = "set-badge-count";

// ---------------------------------------------------------------------------
// Service types shared across processes
// ---------------------------------------------------------------------------

export interface GhPrListItem {
  number: number;
  title: string;
  author: { login: string };
  headRefName: string;
  baseRefName: string;
  reviewDecision: string;
  statusCheckRollup: Array<{
    name: string;
    status: string;
    conclusion: string | null;
  }>;
  updatedAt: string;
  url: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
}

export interface GhPrDetail {
  number: number;
  title: string;
  body: string;
  author: { login: string };
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  reviewDecision: string;
  mergeable: string;
  statusCheckRollup: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    detailsUrl: string;
  }>;
  reviews: Array<{
    author: { login: string };
    state: string;
    submittedAt: string;
  }>;
  files: Array<{
    path: string;
    additions: number;
    deletions: number;
  }>;
  updatedAt: string;
  url: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
}

export interface GhCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string;
  startedAt: string;
  completedAt: string | null;
}

export interface GhReviewComment {
  id: number;
  body: string;
  path: string;
  line: number | null;
  original_line: number | null;
  side: "LEFT" | "RIGHT";
  user: { login: string; avatar_url: string };
  created_at: string;
  updated_at: string;
  in_reply_to_id?: number;
  /** GraphQL node ID for thread resolution (only on root comments) */
  node_id?: string;
}

export interface GhAnnotation {
  path: string;
  startLine: number;
  endLine: number;
  level: "notice" | "warning" | "failure";
  message: string;
  title: string;
  checkName: string;
}

export interface GhWorkflow {
  id: number;
  name: string;
  state: "active" | "disabled_manually" | "disabled_inactivity";
}

export interface GhWorkflowRun {
  databaseId: number;
  displayTitle: string;
  name: string;
  status: string;
  conclusion: string | null;
  headBranch: string;
  createdAt: string;
  updatedAt: string;
  event: string;
  workflowName: string;
  attempt: number;
}

export interface GhWorkflowRunJob {
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string;
  completedAt: string | null;
  steps: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    number: number;
  }>;
}

export interface GhWorkflowRunDetail extends GhWorkflowRun {
  headSha: string;
  jobs: GhWorkflowRunJob[];
}

export interface BlameLine {
  sha: string;
  author: string;
  date: string;
  summary: string;
}

export interface LogEntry {
  sha: string;
  author: string;
  date: string;
  message: string;
}

export interface Workspace {
  id: number;
  path: string;
  name: string;
  addedAt: string;
}

export interface GhUser {
  login: string;
  avatarUrl: string;
  name: string | null;
}

export interface GhAccount {
  login: string;
  host: string;
  active: boolean;
  scopes: string;
  gitProtocol: string;
}

export interface RepoInfo {
  nameWithOwner: string;
  isFork: boolean;
  parent: string | null; // "owner/name" of upstream repo, or null
  canPush: boolean;
}

export interface EnvStatus {
  ghVersion: string | null;
  gitVersion: string | null;
  ghAuth: boolean;
}

// ---------------------------------------------------------------------------
// IPC Method Map
// ---------------------------------------------------------------------------

export interface IpcApi {
  // Preferences
  "preferences.get": { args: { key: string }; result: string | null };
  "preferences.set": { args: { key: string; value: string }; result: void };
  "preferences.getAll": {
    args: { keys: string[] };
    result: Record<string, string | null>;
  };

  "env.check": { args: void; result: EnvStatus };
  "env.user": { args: void; result: GhUser | null };
  "env.accounts": { args: void; result: GhAccount[] };
  "env.switchAccount": { args: { host: string; login: string }; result: void };

  "repo.info": { args: { cwd: string }; result: RepoInfo };

  "workspace.list": { args: void; result: Workspace[] };
  "workspace.add": { args: { path: string }; result: { path: string; name: string } };
  "workspace.remove": { args: { id: number }; result: void };
  "workspace.active": { args: void; result: string | null };
  "workspace.setActive": { args: { path: string }; result: void };
  "workspace.pickFolder": { args: void; result: string | null };

  "pr.list": {
    args: { cwd: string; filter: "reviewRequested" | "authored" | "all" };
    result: GhPrListItem[];
  };
  "pr.detail": { args: { cwd: string; prNumber: number }; result: GhPrDetail };
  "pr.diff": { args: { cwd: string; prNumber: number }; result: string };
  "pr.merge": {
    args: {
      cwd: string;
      prNumber: number;
      strategy: "merge" | "squash" | "rebase";
      admin?: boolean;
    };
    result: void;
  };
  "pr.mergeQueueStatus": {
    args: { cwd: string; prNumber: number };
    result: {
      inQueue: boolean;
      position: number | null;
      state: string | null;
      estimatedTimeToMerge: number | null;
    } | null;
  };
  "pr.comments": { args: { cwd: string; prNumber: number }; result: GhReviewComment[] };
  "pr.createComment": {
    args: { cwd: string; prNumber: number; body: string; path: string; line: number };
    result: void;
  };
  "pr.comment": { args: { cwd: string; prNumber: number; body: string }; result: void };
  "pr.issueComments": {
    args: { cwd: string; prNumber: number };
    result: Array<{
      id: string;
      body: string;
      author: { login: string };
      createdAt: string;
    }>;
  };
  "pr.contributors": {
    args: { cwd: string; prNumber: number };
    result: string[];
  };
  "pr.searchUsers": {
    args: { cwd: string; query: string };
    result: Array<{ login: string; name: string | null }>;
  };
  "pr.issuesList": {
    args: { cwd: string; limit?: number };
    result: Array<{
      number: number;
      title: string;
      state: string;
      isPr: boolean;
    }>;
  };
  "pr.replyToComment": {
    args: { cwd: string; prNumber: number; commentId: number; body: string };
    result: void;
  };
  "pr.resolveThread": { args: { cwd: string; threadId: string }; result: void };
  "pr.unresolveThread": { args: { cwd: string; threadId: string }; result: void };
  "pr.submitReview": {
    args: {
      cwd: string;
      prNumber: number;
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
      body?: string;
    };
    result: void;
  };

  "checks.list": { args: { cwd: string; prNumber: number }; result: GhCheckRun[] };
  "checks.logs": { args: { cwd: string; runId: number }; result: string };
  "checks.rerunFailed": { args: { cwd: string; runId: number }; result: void };
  "checks.annotations": { args: { cwd: string; prNumber: number }; result: GhAnnotation[] };

  "git.blame": {
    args: { cwd: string; file: string; line: number; ref: string };
    result: BlameLine;
  };
  "git.fileHistory": {
    args: { cwd: string; filePath: string; limit?: number };
    result: LogEntry[];
  };
  "git.diff": { args: { cwd: string; fromRef: string; toRef: string }; result: string };
  "git.showFile": { args: { cwd: string; ref: string; filePath: string }; result: string | null };
  "git.repoRoot": { args: { cwd: string }; result: string | null };

  // Workflows
  "workflows.list": { args: { cwd: string }; result: GhWorkflow[] };
  "workflows.runs": {
    args: { cwd: string; workflowId?: number; limit?: number };
    result: GhWorkflowRun[];
  };
  "workflows.runDetail": { args: { cwd: string; runId: number }; result: GhWorkflowRunDetail };
  "workflows.trigger": {
    args: { cwd: string; workflowId: string; ref: string; inputs?: Record<string, string> };
    result: void;
  };
  "workflows.cancel": { args: { cwd: string; runId: number }; result: void };
  "workflows.rerunAll": { args: { cwd: string; runId: number }; result: void };
  "workflows.yaml": { args: { cwd: string; workflowId: string }; result: string };

  "review.getLastSha": { args: { repo: string; prNumber: number }; result: string | null };
  "review.saveSha": { args: { repo: string; prNumber: number; sha: string }; result: void };
  "review.viewedFiles": { args: { repo: string; prNumber: number }; result: string[] };
  "review.setFileViewed": {
    args: { repo: string; prNumber: number; filePath: string; viewed: boolean };
    result: void;
  };

  // Multi-repo (3.1)
  "pr.listAll": {
    args: { filter: "reviewRequested" | "authored" | "all" };
    result: Array<GhPrListItem & { workspace: string; workspacePath: string }>;
  };

  // Metrics (3.2)
  "metrics.prCycleTime": {
    args: { cwd: string; since: string };
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
    args: { cwd: string; since: string };
    result: Array<{
      reviewer: string;
      reviewCount: number;
      avgResponseTime: number;
    }>;
  };

  // AI (3.3)
  "ai.complete": {
    args: {
      provider: "openai" | "anthropic" | "ollama";
      model: string;
      apiKey: string;
      baseUrl?: string;
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      maxTokens?: number;
    };
    result: string;
  };

  // Releases (3.4)
  "releases.list": {
    args: { cwd: string; limit?: number };
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
    args: {
      cwd: string;
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
    args: { cwd: string; sinceTag: string };
    result: string;
  };

  // Notifications (3.5)
  "notifications.list": {
    args: { limit?: number };
    result: Array<{
      id: number;
      type: "review" | "ci-fail" | "approve" | "merge";
      title: string;
      body: string;
      prNumber: number;
      workspace: string;
      read: boolean;
      createdAt: string;
    }>;
  };
  "notifications.markRead": { args: { id: number }; result: void };
  "notifications.markAllRead": { args: void; result: void };
  "notifications.insert": {
    args: {
      type: "review" | "ci-fail" | "approve" | "merge";
      title: string;
      body: string;
      prNumber: number;
      workspace: string;
    };
    result: void;
  };
}

export type IpcMethod = keyof IpcApi;
