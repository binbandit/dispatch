import { execFile } from "./shell";

/**
 * GitHub CLI (`gh`) adapter.
 *
 * All data fetching from GitHub goes through this service.
 * It shells out to `gh` which uses the user's existing auth token.
 *
 * All commands use `execFile` (argument arrays) to prevent shell injection.
 */

export interface GhUser {
  login: string;
  avatarUrl: string;
  name: string | null;
}

export async function getAuthenticatedUser(): Promise<GhUser | null> {
  try {
    const { stdout } = await execFile(
      "gh",
      ["api", "user", "--jq", "{login: .login, avatarUrl: .avatar_url, name: .name}"],
      { timeout: 10_000 },
    );
    return parseJsonOutput<GhUser>(stdout);
  } catch {
    return null;
  }
}

export interface GhAccount {
  login: string;
  host: string;
  active: boolean;
  scopes: string;
  gitProtocol: string;
}

export async function listAccounts(): Promise<GhAccount[]> {
  try {
    const { stdout } = await execFile("gh", ["auth", "status", "--json", "hosts"], {
      timeout: 10_000,
    });
    const data = parseJsonOutput<{
      hosts: Record<
        string,
        Array<{
          login: string;
          host: string;
          active: boolean;
          scopes: string;
          gitProtocol: string;
          state: string;
        }>
      >;
    }>(stdout);

    const accounts: GhAccount[] = [];
    for (const [host, entries] of Object.entries(data.hosts)) {
      for (const entry of entries) {
        if (entry.state === "success") {
          accounts.push({
            login: entry.login,
            host,
            active: entry.active,
            scopes: entry.scopes,
            gitProtocol: entry.gitProtocol,
          });
        }
      }
    }
    return accounts;
  } catch {
    return [];
  }
}

export async function switchAccount(host: string, login: string): Promise<void> {
  await execFile("gh", ["auth", "switch", "--hostname", host, "--user", login], {
    timeout: 10_000,
  });
}

// ---------------------------------------------------------------------------
// Repo info (fork detection)
// ---------------------------------------------------------------------------

export interface RepoInfo {
  nameWithOwner: string;
  isFork: boolean;
  parent: string | null;
}

export async function getRepoInfo(cwd: string): Promise<RepoInfo> {
  const { stdout } = await execFile(
    "gh",
    ["repo", "view", "--json", "nameWithOwner,isFork,parent"],
    { cwd, timeout: 10_000 },
  );
  const data = parseJsonOutput<{
    nameWithOwner: string;
    isFork: boolean;
    parent: { owner: { login: string }; name: string } | null;
  }>(stdout);
  return {
    nameWithOwner: data.nameWithOwner,
    isFork: data.isFork,
    parent: data.parent ? `${data.parent.owner.login}/${data.parent.name}` : null,
  };
}

export async function isGhAuthenticated(): Promise<boolean> {
  try {
    await execFile("gh", ["auth", "status"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse JSON output from `gh` commands.
 * Handles paginated output where `gh api --paginate` concatenates multiple
 * JSON arrays (e.g. `[...][...]`).
 */
function parseJsonOutput<T>(stdout: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [] as unknown as T;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Handle paginated concatenation: `[...][...]` -> merge into single array
    const arrays: unknown[] = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === "[") {
        if (depth === 0) {
          start = i;
        }
        depth++;
      } else if (trimmed[i] === "]") {
        depth--;
        if (depth === 0 && start >= 0) {
          const chunk = JSON.parse(trimmed.slice(start, i + 1)) as unknown[];
          arrays.push(...chunk);
          start = -1;
        }
      }
    }
    return arrays as unknown as T;
  }
}

// ---------------------------------------------------------------------------
// PR operations
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

const PR_LIST_FIELDS = [
  "number",
  "title",
  "author",
  "headRefName",
  "baseRefName",
  "reviewDecision",
  "statusCheckRollup",
  "updatedAt",
  "url",
  "isDraft",
  "additions",
  "deletions",
].join(",");

export async function listPrs(
  cwd: string,
  filter: "reviewRequested" | "authored" = "reviewRequested",
): Promise<GhPrListItem[]> {
  const args =
    filter === "reviewRequested"
      ? [
          "pr",
          "list",
          "--search",
          "review-requested:@me",
          "--json",
          PR_LIST_FIELDS,
          "--limit",
          "50",
        ]
      : ["pr", "list", "--author", "@me", "--json", PR_LIST_FIELDS, "--limit", "50"];
  const { stdout } = await execFile("gh", args, { cwd });
  return parseJsonOutput<GhPrListItem[]>(stdout);
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

const PR_DETAIL_FIELDS = [
  "number",
  "title",
  "body",
  "author",
  "headRefName",
  "baseRefName",
  "headRefOid",
  "reviewDecision",
  "mergeable",
  "statusCheckRollup",
  "reviews",
  "files",
  "updatedAt",
  "url",
  "isDraft",
  "additions",
  "deletions",
].join(",");

export async function getPrDetail(cwd: string, prNumber: number): Promise<GhPrDetail> {
  const { stdout } = await execFile(
    "gh",
    ["pr", "view", String(prNumber), "--json", PR_DETAIL_FIELDS],
    { cwd },
  );
  return parseJsonOutput<GhPrDetail>(stdout);
}

// ---------------------------------------------------------------------------
// PR diff
// ---------------------------------------------------------------------------

export async function getPrDiff(cwd: string, prNumber: number): Promise<string> {
  const { stdout } = await execFile("gh", ["pr", "diff", String(prNumber)], { cwd });
  return stdout;
}

// ---------------------------------------------------------------------------
// CI/CD checks
// ---------------------------------------------------------------------------

export interface GhCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string;
  startedAt: string;
  completedAt: string | null;
}

export async function getPrChecks(cwd: string, prNumber: number): Promise<GhCheckRun[]> {
  const { stdout } = await execFile(
    "gh",
    [
      "pr",
      "checks",
      String(prNumber),
      "--json",
      "name,status,conclusion,detailsUrl,startedAt,completedAt",
    ],
    { cwd },
  );
  return parseJsonOutput<GhCheckRun[]>(stdout);
}

export interface GhRunLog {
  jobs: Array<{
    name: string;
    steps: Array<{
      name: string;
      status: string;
      conclusion: string | null;
      number: number;
      log: string;
    }>;
  }>;
}

export async function getRunLogs(cwd: string, runId: number): Promise<string> {
  const { stdout } = await execFile("gh", ["run", "view", String(runId), "--log"], {
    cwd,
    timeout: 60_000,
  });
  return stdout;
}

export async function rerunFailedJobs(cwd: string, runId: number): Promise<void> {
  await execFile("gh", ["run", "rerun", String(runId), "--failed"], { cwd });
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export type MergeStrategy = "merge" | "squash" | "rebase";

export async function mergePr(
  cwd: string,
  prNumber: number,
  strategy: MergeStrategy,
): Promise<void> {
  await execFile("gh", ["pr", "merge", String(prNumber), `--${strategy}`, "--delete-branch"], {
    cwd,
  });
}

// ---------------------------------------------------------------------------
// Review comments
// ---------------------------------------------------------------------------

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

export async function getPrReviewComments(
  cwd: string,
  prNumber: number,
): Promise<GhReviewComment[]> {
  const { stdout } = await execFile(
    "gh",
    ["api", `repos/{owner}/{repo}/pulls/${prNumber}/comments`, "--paginate"],
    { cwd, timeout: 30_000 },
  );
  return parseJsonOutput<GhReviewComment[]>(stdout);
}

export async function createReviewComment(args: {
  cwd: string;
  prNumber: number;
  body: string;
  path: string;
  line: number;
}): Promise<void> {
  const { stdout: commitSha } = await execFile(
    "gh",
    ["pr", "view", String(args.prNumber), "--json", "headRefOid", "--jq", ".headRefOid"],
    { cwd: args.cwd },
  );

  await execFile(
    "gh",
    [
      "api",
      `repos/{owner}/{repo}/pulls/${args.prNumber}/comments`,
      "-X",
      "POST",
      "-f",
      `body=${args.body}`,
      "-f",
      `path=${args.path}`,
      "-F",
      `line=${args.line}`,
      "-f",
      "side=RIGHT",
      "-f",
      `commit_id=${commitSha.trim()}`,
    ],
    { cwd: args.cwd, timeout: 15_000 },
  );
}

// ---------------------------------------------------------------------------
// Submit review
// ---------------------------------------------------------------------------

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export async function submitReview(args: {
  cwd: string;
  prNumber: number;
  event: ReviewEvent;
  body?: string;
}): Promise<void> {
  const ghArgs = ["pr", "review", String(args.prNumber)];
  switch (args.event) {
    case "APPROVE": {
      ghArgs.push("--approve");
      break;
    }
    case "REQUEST_CHANGES": {
      ghArgs.push("--request-changes");
      break;
    }
    case "COMMENT": {
      ghArgs.push("--comment");
      break;
    }
  }
  if (args.body) {
    ghArgs.push("--body", args.body);
  }
  await execFile("gh", ghArgs, { cwd: args.cwd, timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// CI Annotations
// ---------------------------------------------------------------------------

export interface GhAnnotation {
  path: string;
  startLine: number;
  endLine: number;
  level: "notice" | "warning" | "failure";
  message: string;
  title: string;
  checkName: string;
}

export async function getCheckAnnotations(cwd: string, prNumber: number): Promise<GhAnnotation[]> {
  const checks = await getPrChecks(cwd, prNumber);
  const failingChecks = checks.filter((c) => c.conclusion === "failure");

  const annotationPromises = failingChecks.map(async (check) => {
    const runIdMatch = check.detailsUrl?.match(/\/runs\/(\d+)/);
    if (!runIdMatch) {
      return [];
    }
    const [, runId] = runIdMatch;

    try {
      const { stdout } = await execFile(
        "gh",
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
      return parsed.map((a) => ({
        path: a.path,
        startLine: a.start_line,
        endLine: a.end_line,
        level: a.annotation_level,
        message: a.message,
        title: a.title,
        checkName: check.name,
      }));
    } catch {
      // Annotations not available for this check
      return [];
    }
  });

  const results = await Promise.all(annotationPromises);
  return results.flat();
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export interface GhWorkflow {
  id: number;
  name: string;
  state: "active" | "disabled_manually" | "disabled_inactivity";
}

export async function listWorkflows(cwd: string): Promise<GhWorkflow[]> {
  const { stdout } = await execFile(
    "gh",
    ["workflow", "list", "--json", "id,name,state", "--limit", "50"],
    { cwd },
  );
  return parseJsonOutput<GhWorkflow[]>(stdout);
}

export interface GhWorkflowRun {
  databaseId: number;
  displayTitle: string;
  name: string;
  status: string;
  conclusion: string | null;
  headBranch: string;
  createdAt: string;
  updatedAt: string;
  event: string;
  workflowName: string;
  attempt: number;
}

export async function listWorkflowRuns(
  cwd: string,
  workflowId?: number,
  limit = 20,
): Promise<GhWorkflowRun[]> {
  const ghArgs = [
    "run",
    "list",
    "--json",
    "databaseId,displayTitle,name,status,conclusion,headBranch,createdAt,updatedAt,event,workflowName,attempt",
    "--limit",
    String(limit),
  ];
  if (workflowId) {
    ghArgs.push("--workflow", String(workflowId));
  }
  const { stdout } = await execFile("gh", ghArgs, { cwd });
  return parseJsonOutput<GhWorkflowRun[]>(stdout);
}

export interface GhWorkflowRunJob {
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string;
  completedAt: string | null;
  steps: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    number: number;
  }>;
}

export interface GhWorkflowRunDetail extends GhWorkflowRun {
  headSha: string;
  jobs: GhWorkflowRunJob[];
}

export async function getWorkflowRunDetail(
  cwd: string,
  runId: number,
): Promise<GhWorkflowRunDetail> {
  const { stdout } = await execFile(
    "gh",
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
  await execFile("gh", ghArgs, { cwd: args.cwd, timeout: 15_000 });
}

export async function cancelWorkflowRun(cwd: string, runId: number): Promise<void> {
  await execFile("gh", ["run", "cancel", String(runId)], { cwd });
}

export async function rerunWorkflowRun(cwd: string, runId: number): Promise<void> {
  await execFile("gh", ["run", "rerun", String(runId)], { cwd });
}

export async function getWorkflowYaml(cwd: string, workflowId: string): Promise<string> {
  const { stdout } = await execFile("gh", ["workflow", "view", workflowId, "--yaml"], {
    cwd,
  });
  return stdout;
}
