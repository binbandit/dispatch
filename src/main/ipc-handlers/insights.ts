import type { HandlerMap } from "./types";

import * as repo from "../db/repository";
import * as ghCli from "../services/gh-cli";

export const insightsHandlers: Pick<
  HandlerMap,
  | "pr.listAll"
  | "pr.listAllEnrichment"
  | "metrics.prCycleTime"
  | "metrics.reviewLoad"
  | "releases.list"
  | "releases.create"
  | "releases.generateChangelog"
> = {
  "pr.listAll": (args) => {
    const workspaces = repo.getWorkspaces();
    return ghCli.listAllPrs(workspaces, args.filter, args.state);
  },
  "pr.listAllEnrichment": (args) => {
    const workspaces = repo.getWorkspaces();
    return ghCli.listAllPrsEnrichment(workspaces, args.filter, args.state);
  },
  "metrics.prCycleTime": (args) => ghCli.getPrCycleTime(args, args.since),
  "metrics.reviewLoad": (args) => ghCli.getReviewLoad(args, args.since),
  "releases.list": (args) => ghCli.listReleases(args, args.limit),
  "releases.create": (args) => ghCli.createRelease(args),
  "releases.generateChangelog": (args) => ghCli.generateChangelog(args, args.sinceTag),
};
