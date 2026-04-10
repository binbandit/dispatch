import type {
  GhWorkflow,
  GhWorkflowJobGraph,
  GhWorkflowRun,
  GhWorkflowRunDetail,
  RepoTarget,
} from "../../ipc";

export interface WorkflowIpcApi {
  "workflows.list": { args: RepoTarget; result: GhWorkflow[] };
  "workflows.runs": {
    args: RepoTarget & { workflowId?: number; limit?: number };
    result: GhWorkflowRun[];
  };
  "workflows.runDetail": { args: RepoTarget & { runId: number }; result: GhWorkflowRunDetail };
  "workflows.trigger": {
    args: RepoTarget & { workflowId: string; ref: string; inputs?: Record<string, string> };
    result: void;
  };
  "workflows.cancel": { args: RepoTarget & { runId: number }; result: void };
  "workflows.rerunAll": { args: RepoTarget & { runId: number }; result: void };
  "workflows.yaml": { args: RepoTarget & { workflowId: string }; result: string };
  "workflows.jobGraph": {
    args: RepoTarget & { workflowId: string };
    result: GhWorkflowJobGraph;
  };
}
