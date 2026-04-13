import type { BlameLine, RepoTarget } from "../../ipc";

export interface GitIpcApi {
  "git.blame": {
    args: { cwd: string; file: string; line: number; ref: string };
    result: BlameLine;
  };
  "git.diff": { args: { cwd: string; fromRef: string; toRef: string }; result: string };
  "git.commitDiff": { args: { cwd: string; sha: string }; result: string };
  "git.repoRoot": { args: { cwd: string }; result: string | null };
  "gh.fileAtRef": {
    args: RepoTarget & { ref: string; filePath: string };
    result: string | null;
  };
}
