/* eslint-disable no-await-in-loop, no-continue, prefer-destructuring, init-declarations, @typescript-eslint/no-non-null-assertion -- Workflow and check commands are intentionally mapped directly to gh invocations. */
import type {
  GhAnnotation,
  GhCheckRun,
  GhWorkflow,
  GhWorkflowJobGraph,
  GhWorkflowRun,
  GhWorkflowRunDetail,
} from "../../../shared/ipc";

import { parse as parseYaml } from "yaml";

import {
  type RepoTarget,
  genericCache,
  getOrLoadCached,
  ghExec,
  invalidateWorkflowCaches,
  parseJsonOutput,
  resolveRepoCwd,
} from "./core";

export async function getPrChecks(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
): Promise<GhCheckRun[]> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  let stdout: string;
  try {
    const result = await ghExec(
      [
        ...resolved.repoFlag,
        "pr",
        "checks",
        String(prNumber),
        "--json",
        "name,state,bucket,link,startedAt,completedAt",
      ],
      { cwd: resolved.cwd },
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

export async function getRunLogs(cwdOrTarget: string | RepoTarget, runId: number): Promise<string> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const { stdout } = await ghExec([...resolved.repoFlag, "run", "view", String(runId), "--log"], {
    cwd: resolved.cwd,
    timeout: 60_000,
  });
  return stdout;
}

export async function rerunFailedJobs(
  cwdOrTarget: string | RepoTarget,
  runId: number,
): Promise<void> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  await ghExec([...resolved.repoFlag, "run", "rerun", String(runId), "--failed"], {
    cwd: resolved.cwd,
  });
  invalidateWorkflowCaches(resolved.nwo);
}

export async function getCheckAnnotations(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
): Promise<GhAnnotation[]> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const checks = await getPrChecks(cwdOrTarget, prNumber);
  const failingChecks = checks.filter((check) => check.conclusion === "failure");

  const annotationPromises = failingChecks.map(async (check) => {
    const runIdMatch = check.detailsUrl?.match(/\/runs\/(\d+)/);
    if (!runIdMatch) {
      return [];
    }
    const [, runId] = runIdMatch;

    try {
      const { stdout } = await ghExec(
        [
          ...resolved.repoFlag,
          "api",
          `repos/{owner}/{repo}/check-runs/${runId}/annotations`,
          "--paginate",
        ],
        { cwd: resolved.cwd, timeout: 15_000 },
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

export function listWorkflows(cwdOrTarget: string | RepoTarget): Promise<GhWorkflow[]> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const key = `workflows::${resolved.nwo}`;
  return getOrLoadCached({
    cache: genericCache,
    key,
    loader: async () => {
      const { stdout } = await ghExec(
        [...resolved.repoFlag, "workflow", "list", "--json", "id,name,state", "--limit", "50"],
        { cwd: resolved.cwd },
      );
      return parseJsonOutput<GhWorkflow[]>(stdout);
    },
  }) as Promise<GhWorkflow[]>;
}

export function listWorkflowRuns(
  cwdOrTarget: string | RepoTarget,
  workflowId?: number,
  limit = 20,
): Promise<GhWorkflowRun[]> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const effectiveLimit = Math.min(limit, 50);
  const key = `workflowRuns::${resolved.nwo}::${workflowId ?? "all"}::${effectiveLimit}`;
  return getOrLoadCached({
    cache: genericCache,
    key,
    loader: async () => {
      const ghArgs = [
        ...resolved.repoFlag,
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
      const { stdout } = await ghExec(ghArgs, { cwd: resolved.cwd });
      return parseJsonOutput<GhWorkflowRun[]>(stdout);
    },
  }) as Promise<GhWorkflowRun[]>;
}

export async function getWorkflowRunDetail(
  cwdOrTarget: string | RepoTarget,
  runId: number,
): Promise<GhWorkflowRunDetail> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const { stdout } = await ghExec(
    [
      ...resolved.repoFlag,
      "run",
      "view",
      String(runId),
      "--json",
      "databaseId,displayTitle,name,status,conclusion,headBranch,headSha,createdAt,updatedAt,event,workflowName,workflowDatabaseId,jobs,attempt",
    ],
    { cwd: resolved.cwd },
  );
  return parseJsonOutput<GhWorkflowRunDetail>(stdout);
}

export async function triggerWorkflow(args: {
  cwd: string | null;
  owner: string;
  repo: string;
  workflowId: string;
  ref: string;
  inputs?: Record<string, string>;
}): Promise<void> {
  const target: RepoTarget = { cwd: args.cwd, owner: args.owner, repo: args.repo };
  const resolved = resolveRepoCwd(target);
  const ghArgs = [...resolved.repoFlag, "workflow", "run", args.workflowId, "--ref", args.ref];
  if (args.inputs) {
    for (const [key, value] of Object.entries(args.inputs)) {
      ghArgs.push("-f", `${key}=${value}`);
    }
  }
  await ghExec(ghArgs, { cwd: resolved.cwd, timeout: 15_000 });
  invalidateWorkflowCaches(resolved.nwo);
}

export async function cancelWorkflowRun(
  cwdOrTarget: string | RepoTarget,
  runId: number,
): Promise<void> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  await ghExec([...resolved.repoFlag, "run", "cancel", String(runId)], { cwd: resolved.cwd });
  invalidateWorkflowCaches(resolved.nwo);
}

export async function rerunWorkflowRun(
  cwdOrTarget: string | RepoTarget,
  runId: number,
): Promise<void> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  await ghExec([...resolved.repoFlag, "run", "rerun", String(runId)], { cwd: resolved.cwd });
  invalidateWorkflowCaches(resolved.nwo);
}

export async function getWorkflowYaml(
  cwdOrTarget: string | RepoTarget,
  workflowId: string,
): Promise<string> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const { stdout } = await ghExec(
    [...resolved.repoFlag, "workflow", "view", workflowId, "--yaml"],
    {
      cwd: resolved.cwd,
    },
  );
  return stdout;
}

interface WorkflowYamlJob {
  needs?: string | string[];
}

interface WorkflowYamlDocument {
  jobs?: Record<string, WorkflowYamlJob>;
}

/**
 * Parse job dependency edges from a workflow YAML definition.
 * Returns each job ID with the list of job IDs it depends on (`needs`).
 */
export function parseJobGraphFromYaml(yaml: string): GhWorkflowJobGraph {
  let doc: WorkflowYamlDocument;
  try {
    doc = parseYaml(yaml) as WorkflowYamlDocument;
  } catch {
    return { jobs: [] };
  }

  if (!doc?.jobs || typeof doc.jobs !== "object") {
    return { jobs: [] };
  }

  return {
    jobs: Object.entries(doc.jobs).map(([id, job]) => ({
      id,
      needs: Array.isArray(job?.needs)
        ? job.needs.filter((dep): dep is string => typeof dep === "string")
        : typeof job?.needs === "string"
          ? [job.needs]
          : [],
    })),
  };
}

/**
 * Fetch the workflow YAML for the given workflow and extract the job
 * dependency graph.
 */
export async function getWorkflowJobGraph(
  cwdOrTarget: string | RepoTarget,
  workflowId: string,
): Promise<GhWorkflowJobGraph> {
  const yaml = await getWorkflowYaml(cwdOrTarget, workflowId);
  return parseJobGraphFromYaml(yaml);
}
