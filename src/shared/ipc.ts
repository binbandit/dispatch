/**
 * Typed IPC API contract between main and renderer processes.
 *
 * Every IPC call goes through a single channel "dispatch:ipc".
 * The payload is { method: string, args: unknown }.
 * The response is { ok: true, data: T } | { ok: false, error: string }.
 */

export const IPC_CHANNEL = "dispatch:ipc";

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

export interface EnvStatus {
  ghVersion: string | null;
  gitVersion: string | null;
  ghAuth: boolean;
}

// ---------------------------------------------------------------------------
// IPC Method Map
// ---------------------------------------------------------------------------

export interface IpcApi {
  "env.check": { args: void; result: EnvStatus };

  "workspace.list": { args: void; result: Workspace[] };
  "workspace.add": { args: { path: string }; result: { path: string; name: string } };
  "workspace.remove": { args: { id: number }; result: void };
  "workspace.active": { args: void; result: string | null };
  "workspace.setActive": { args: { path: string }; result: void };
  "workspace.pickFolder": { args: void; result: string | null };

  "pr.list": {
    args: { cwd: string; filter: "reviewRequested" | "authored" };
    result: GhPrListItem[];
  };
  "pr.detail": { args: { cwd: string; prNumber: number }; result: GhPrDetail };
  "pr.diff": { args: { cwd: string; prNumber: number }; result: string };
  "pr.merge": {
    args: { cwd: string; prNumber: number; strategy: "merge" | "squash" | "rebase" };
    result: void;
  };
  "pr.comments": { args: { cwd: string; prNumber: number }; result: GhReviewComment[] };
  "pr.createComment": {
    args: { cwd: string; prNumber: number; body: string; path: string; line: number };
    result: void;
  };
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
  "git.repoRoot": { args: { cwd: string }; result: string | null };

  "review.getLastSha": { args: { repo: string; prNumber: number }; result: string | null };
  "review.saveSha": { args: { repo: string; prNumber: number; sha: string }; result: void };
  "review.viewedFiles": { args: { repo: string; prNumber: number }; result: string[] };
  "review.setFileViewed": {
    args: { repo: string; prNumber: number; filePath: string; viewed: boolean };
    result: void;
  };
}

export type IpcMethod = keyof IpcApi;
