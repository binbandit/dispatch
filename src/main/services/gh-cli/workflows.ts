/* eslint-disable no-await-in-loop, no-continue, prefer-destructuring, init-declarations, @typescript-eslint/no-non-null-assertion -- Workflow and check commands are intentionally mapped directly to gh invocations. */
import type {
  GhAnnotation,
  GhCheckRun,
  GhWorkflow,
  GhWorkflowRun,
  GhWorkflowRunDetail,
} from "../../../shared/ipc";

import {
  genericCache,
  getOrLoadCached,
  ghExec,
  invalidateWorkflowCaches,
  parseJsonOutput,
} from "./core";

export async function getPrChecks(cwd: string, prNumber: number): Promise<GhCheckRun[]> {
  let stdout: string;
  try {
    const result = await ghExec(
      ["pr", "checks", String(prNumber), "--json", "name,state,bucket,link,startedAt,completedAt"],
      { cwd },
    );
    ({ stdout } = result);
  } catch (error) {
    const msg = String((error as Error)?.message ?? "");
    if (msg.includes("no checks reported")) {
      return [];
    }
    throw error;
  }

  const raw = parseJsonOutput<
    Array<{
      name: string;
      state: string;
      bucket: string;
      link: string;
      startedAt: string;
      completedAt: string | null;
    }>
  >(stdout);

  return raw.map((check) => ({
    name: check.name,
    status: check.state,
    conclusion: mapBucketToConclusion(check.bucket),
    detailsUrl: check.link,
    startedAt: check.startedAt,
    completedAt: check.completedAt,
  }));
}

function mapBucketToConclusion(bucket: string): string | null {
  switch (bucket) {
    case "pass": {
      return "success";
    }
    case "fail": {
      return "failure";
    }
    case "pending": {
      return null;
    }
    case "skipping": {
      return "skipped";
    }
    default: {
      return bucket || null;
    }
  }
}

export async function getRunLogs(cwd: string, runId: number): Promise<string> {
  const { stdout } = await ghExec(["run", "view", String(runId), "--log"], {
    cwd,
    timeout: 60_000,
  });
  return stdout;
}

export async function rerunFailedJobs(cwd: string, runId: number): Promise<void> {
  await ghExec(["run", "rerun", String(runId), "--failed"], { cwd });
  invalidateWorkflowCaches(cwd);
}

export async function getCheckAnnotations(cwd: string, prNumber: number): Promise<GhAnnotation[]> {
  const checks = await getPrChecks(cwd, prNumber);
  const failingChecks = checks.filter((check) => check.conclusion === "failure");

  const annotationPromises = failingChecks.map(async (check) => {
    const runIdMatch = check.detailsUrl?.match(/\/runs\/(\d+)/);
    if (!runIdMatch) {
      return [];
    }
    const [, runId] = runIdMatch;

    try {
      const { stdout } = await ghExec(
        ["api", `repos/{owner}/{repo}/check-runs/${runId}/annotations`, "--paginate"],
        { cwd, timeout: 15_000 },
      );
      const parsed = parseJsonOutput<
        Array<{
          path: string;
          start_line: number;
          end_line: number;
          annotation_level: "notice" | "warning" | "failure";
          message: string;
          title: string;
        }>
      >(stdout);
      return parsed.map((annotation) => ({
        path: annotation.path,
        startLine: annotation.start_line,
        endLine: annotation.end_line,
        level: annotation.annotation_level,
        message: annotation.message,
        title: annotation.title,
        checkName: check.name,
      }));
    } catch {
      return [];
    }
  });

  const results = await Promise.all(annotationPromises);
  return results.flat();
}

export function listWorkflows(cwd: string): Promise<GhWorkflow[]> {
  const key = `workflows::${cwd}`;
  return getOrLoadCached({
    cache: genericCache,
    key,
    loader: async () => {
      const { stdout } = await ghExec(
        ["workflow", "list", "--json", "id,name,state", "--limit", "50"],
        { cwd },
      );
      return parseJsonOutput<GhWorkflow[]>(stdout);
    },
  }) as Promise<GhWorkflow[]>;
}

export function listWorkflowRuns(
  cwd: string,
  workflowId?: number,
  limit = 20,
): Promise<GhWorkflowRun[]> {
  const effectiveLimit = Math.min(limit, 50);
  const key = `workflowRuns::${cwd}::${workflowId ?? "all"}::${effectiveLimit}`;
  return getOrLoadCached({
    cache: genericCache,
    key,
    loader: async () => {
      const ghArgs = [
        "run",
        "list",
        "--json",
        "databaseId,displayTitle,name,status,conclusion,headBranch,createdAt,updatedAt,event,workflowName,attempt",
        "--limit",
        String(effectiveLimit),
      ];
      if (workflowId) {
        ghArgs.push("--workflow", String(workflowId));
      }
      const { stdout } = await ghExec(ghArgs, { cwd });
      return parseJsonOutput<GhWorkflowRun[]>(stdout);
    },
  }) as Promise<GhWorkflowRun[]>;
}

export async function getWorkflowRunDetail(
  cwd: string,
  runId: number,
): Promise<GhWorkflowRunDetail> {
  const { stdout } = await ghExec(
    [
      "run",
      "view",
      String(runId),
      "--json",
      "databaseId,displayTitle,name,status,conclusion,headBranch,headSha,createdAt,updatedAt,event,workflowName,jobs,attempt",
    ],
    { cwd },
  );
  return parseJsonOutput<GhWorkflowRunDetail>(stdout);
}

export async function triggerWorkflow(args: {
  cwd: string;
  workflowId: string;
  ref: string;
  inputs?: Record<string, string>;
}): Promise<void> {
  const ghArgs = ["workflow", "run", args.workflowId, "--ref", args.ref];
  if (args.inputs) {
    for (const [key, value] of Object.entries(args.inputs)) {
      ghArgs.push("-f", `${key}=${value}`);
    }
  }
  await ghExec(ghArgs, { cwd: args.cwd, timeout: 15_000 });
  invalidateWorkflowCaches(args.cwd);
}

export async function cancelWorkflowRun(cwd: string, runId: number): Promise<void> {
  await ghExec(["run", "cancel", String(runId)], { cwd });
  invalidateWorkflowCaches(cwd);
}

export async function rerunWorkflowRun(cwd: string, runId: number): Promise<void> {
  await ghExec(["run", "rerun", String(runId)], { cwd });
  invalidateWorkflowCaches(cwd);
}

export async function getWorkflowYaml(cwd: string, workflowId: string): Promise<string> {
  const { stdout } = await ghExec(["workflow", "view", workflowId, "--yaml"], {
    cwd,
  });
  return stdout;
}
