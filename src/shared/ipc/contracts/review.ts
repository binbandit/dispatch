import type { PrActivityState } from "../../ipc";

export type ReviewDiffMode = "all" | "since-review";

export type ReviewPanelTab = "overview" | "conversation" | "commits" | "checks";

export interface ReviewResumeSelectedCommit {
  oid: string;
  message: string;
}

export interface ReviewResumeState {
  workspace: string;
  view: "review" | "workflows" | "metrics" | "releases" | "merge-queue" | "settings";
  prNumber: number | null;
  currentFilePath: string | null;
  currentFileIndex: number;
  diffMode: ReviewDiffMode;
  panelOpen: boolean;
  panelTab: ReviewPanelTab;
  selectedCommit: ReviewResumeSelectedCommit | null;
  updatedAt: string;
}

export interface ReviewStateIpcApi {
  "review.getLastSha": { args: { repo: string; prNumber: number }; result: string | null };
  "review.saveSha": { args: { repo: string; prNumber: number; sha: string }; result: void };
  "review.getResumeState": { args: { workspace: string }; result: ReviewResumeState | null };
  "review.saveResumeState": {
    args: Omit<ReviewResumeState, "updatedAt">;
    result: void;
  };
  "review.viewedFiles": { args: { repo: string; prNumber: number }; result: string[] };
  "review.setFileViewed": {
    args: { repo: string; prNumber: number; filePath: string; viewed: boolean };
    result: void;
  };
  "review.setFilesViewed": {
    args: { repo: string; prNumber: number; filePaths: string[]; viewed: boolean };
    result: void;
  };
  "prActivity.list": { args: void; result: PrActivityState[] };
  "prActivity.markSeen": {
    args: { repo: string; prNumber: number; updatedAt: string };
    result: void;
  };
  "comment.getMinimized": {
    args: { repo: string; prNumber: number };
    result: string[];
  };
  "comment.setMinimized": {
    args: { repo: string; prNumber: number; commentId: string; minimized: boolean };
    result: void;
  };
}
