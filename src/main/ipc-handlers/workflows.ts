import type { HandlerMap } from "./types";

import * as ghCli from "../services/gh-cli";

export const workflowHandlers: Pick<
  HandlerMap,
  | "workflows.list"
  | "workflows.runs"
  | "workflows.runDetail"
  | "workflows.trigger"
  | "workflows.cancel"
  | "workflows.rerunAll"
  | "workflows.yaml"
  | "workflows.jobGraph"
> = {
  "workflows.list": (args) => ghCli.listWorkflows(args),
  "workflows.runs": (args) => ghCli.listWorkflowRuns(args, args.workflowId, args.limit),
  "workflows.runDetail": (args) => ghCli.getWorkflowRunDetail(args, args.runId),
  "workflows.trigger": async (args) => {
    await ghCli.triggerWorkflow(args);
  },
  "workflows.cancel": async (args) => {
    await ghCli.cancelWorkflowRun(args, args.runId);
  },
  "workflows.rerunAll": async (args) => {
    await ghCli.rerunWorkflowRun(args, args.runId);
  },
  "workflows.yaml": (args) => ghCli.getWorkflowYaml(args, args.workflowId),
  "workflows.jobGraph": (args) => ghCli.getWorkflowJobGraph(args, args.workflowId),
};
