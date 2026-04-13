import type { HandlerMap } from "./types";

import * as ghCli from "../services/gh-cli";
import * as gitCli from "../services/git-cli";

export const gitHandlers: Pick<
  HandlerMap,
  "git.blame" | "git.diff" | "git.commitDiff" | "git.repoRoot" | "gh.fileAtRef"
> = {
  "git.blame": (args) => gitCli.blame(args),
  "git.diff": (args) => gitCli.diff(args.cwd, args.fromRef, args.toRef),
  "git.commitDiff": (args) => gitCli.commitDiff(args.cwd, args.sha),
  "git.repoRoot": (args) => gitCli.getRepoRoot(args.cwd),
  "gh.fileAtRef": (args) => ghCli.getFileAtRef(args, args.ref, args.filePath),
};
