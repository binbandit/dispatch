import type { HandlerMap } from "./types";

import * as ghCli from "../services/gh-cli";
import * as gitCli from "../services/git-cli";

export const gitHandlers: Pick<
  HandlerMap,
  | "git.blame"
  | "git.fileHistory"
  | "git.diff"
  | "git.commitDiff"
  | "git.showFile"
  | "git.repoRoot"
  | "gh.fileAtRef"
> = {
  "git.blame": (args) => gitCli.blame(args),
  "git.fileHistory": (args) => gitCli.fileHistory(args.cwd, args.filePath, args.limit),
  "git.diff": (args) => gitCli.diff(args.cwd, args.fromRef, args.toRef),
  "git.commitDiff": (args) => gitCli.commitDiff(args.cwd, args.sha),
  "git.showFile": (args) => gitCli.showFile(args.cwd, args.ref, args.filePath),
  "git.repoRoot": (args) => gitCli.getRepoRoot(args.cwd),
  "gh.fileAtRef": (args) => ghCli.getFileAtRef(args, args.ref, args.filePath),
};
