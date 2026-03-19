import type {
  GhAccount,
  GhAnnotation,
  GhCheckRun,
  GhPrDetail,
  GhPrListItem,
  GhReviewComment,
  GhUser,
  RepoInfo,
  GhWorkflow,
  GhWorkflowRun,
  GhWorkflowRunDetail,
} from "../../shared/ipc";

import { execFile } from "./shell";

/**
 * GitHub CLI (`gh`) adapter.
 *
 * All data fetching from GitHub goes through this service.
 * It shells out to `gh` which uses the user's existing auth token.
 *
 * All commands use `execFile` (argument arrays) to prevent shell injection.
 *
 * Types are imported from shared/ipc.ts — single source of truth.
 */

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

export async function getRepoInfo(cwd: string): Promise<RepoInfo> {
  const { stdout } = await execFile(
    "gh",
    ["repo", "view", "--json", "nameWithOwner,isFork,parent,viewerPermission"],
    { cwd, timeout: 10_000 },
  );
  const data = parseJsonOutput<{
    nameWithOwner: string;
    isFork: boolean;
    parent: { owner: { login: string }; name: string } | null;
    viewerPermission: string;
  }>(stdout);
  // viewerPermission is: ADMIN, MAINTAIN, WRITE, TRIAGE, READ
  const canPush = ["ADMIN", "MAINTAIN", "WRITE"].includes(data.viewerPermission);
  return {
    nameWithOwner: data.nameWithOwner,
    isFork: data.isFork,
    parent: data.parent ? `${data.parent.owner.login}/${data.parent.name}` : null,
    canPush,
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
  filter: "reviewRequested" | "authored" | "all" = "reviewRequested",
): Promise<GhPrListItem[]> {
  let args: string[];
  switch (filter) {
    case "reviewRequested": {
      args = [
        "pr",
        "list",
        "--search",
        "review-requested:@me",
        "--json",
        PR_LIST_FIELDS,
        "--limit",
        "200",
      ];
      break;
    }
    case "authored": {
      args = ["pr", "list", "--author", "@me", "--json", PR_LIST_FIELDS, "--limit", "200"];
      break;
    }
    case "all": {
      args = ["pr", "list", "--json", PR_LIST_FIELDS, "--limit", "200"];
      break;
    }
  }
  const { stdout } = await execFile("gh", args, { cwd });
  return parseJsonOutput<GhPrListItem[]>(stdout);
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

/**
 * Fetch PR checks. The `gh pr checks --json` fields are:
 * name, state, bucket, link, startedAt, completedAt, description, event, workflow
 *
 * We map to our GhCheckRun interface:
 *   state → status, bucket → conclusion, link → detailsUrl
 */
export async function getPrChecks(cwd: string, prNumber: number): Promise<GhCheckRun[]> {
  let stdout: string;
  try {
    const result = await execFile(
      "gh",
      ["pr", "checks", String(prNumber), "--json", "name,state,bucket,link,startedAt,completedAt"],
      { cwd },
    );
    stdout = result.stdout;
  } catch (err) {
    // "no checks reported on the 'branch' branch" — not an error, just empty
    const msg = String((err as Error)?.message ?? "");
    if (msg.includes("no checks reported")) {
      return [];
    }
    throw err;
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

/** Map gh's "bucket" field to GitHub's conclusion values */
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
  admin = false,
): Promise<void> {
  const args = ["pr", "merge", String(prNumber), `--${strategy}`, "--delete-branch"];
  if (admin) {
    args.push("--admin");
  }
  await execFile("gh", args, { cwd });
}

export async function getMergeQueueStatus(
  cwd: string,
  prNumber: number,
): Promise<{
  inQueue: boolean;
  position: number | null;
  state: string | null;
  estimatedTimeToMerge: number | null;
} | null> {
  try {
    const { stdout } = await execFile(
      "gh",
      [
        "api",
        "graphql",
        "-f",
        `query=query { repository(owner: "{owner}", name: "{repo}") { pullRequest(number: ${prNumber}) { mergeQueueEntry { position state estimatedTimeToMerge } } } }`,
      ],
      { cwd, timeout: 10_000 },
    );
    const data = JSON.parse(stdout) as {
      data?: {
        repository?: {
          pullRequest?: {
            mergeQueueEntry: {
              position: number;
              state: string;
              estimatedTimeToMerge: number | null;
            } | null;
          };
        };
      };
    };
    const entry = data.data?.repository?.pullRequest?.mergeQueueEntry;
    if (!entry) {
      return { inQueue: false, position: null, state: null, estimatedTimeToMerge: null };
    }
    return {
      inQueue: true,
      position: entry.position,
      state: entry.state,
      estimatedTimeToMerge: entry.estimatedTimeToMerge,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Review comments
// ---------------------------------------------------------------------------

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

export async function replyToReviewComment(
  cwd: string,
  prNumber: number,
  commentId: number,
  body: string,
): Promise<void> {
  await execFile(
    "gh",
    [
      "api",
      `repos/{owner}/{repo}/pulls/${prNumber}/comments`,
      "-X",
      "POST",
      "-f",
      `body=${body}`,
      "-F",
      `in_reply_to=${commentId}`,
    ],
    { cwd, timeout: 15_000 },
  );
}

export async function createPrComment(cwd: string, prNumber: number, body: string): Promise<void> {
  await execFile("gh", ["pr", "comment", String(prNumber), "--body", body], {
    cwd,
    timeout: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Issue/conversation comments (different from review comments)
// ---------------------------------------------------------------------------

export async function getIssueComments(
  cwd: string,
  prNumber: number,
): Promise<Array<{ id: string; body: string; author: { login: string }; createdAt: string }>> {
  const { stdout } = await execFile(
    "gh",
    ["pr", "view", String(prNumber), "--json", "comments", "--jq", ".comments"],
    { cwd, timeout: 15_000 },
  );
  return parseJsonOutput<
    Array<{ id: string; body: string; author: { login: string }; createdAt: string }>
  >(stdout);
}

// ---------------------------------------------------------------------------
// Contributors (for @ mention autocomplete)
// ---------------------------------------------------------------------------

export async function getPrContributors(cwd: string, prNumber: number): Promise<string[]> {
  // Gather unique logins from: PR author, reviewers, commenters
  const { stdout } = await execFile(
    "gh",
    [
      "pr",
      "view",
      String(prNumber),
      "--json",
      "author,reviews,comments",
      "--jq",
      "[.author.login] + [.reviews[].author.login] + [.comments[].author.login] | unique | .[]",
    ],
    { cwd, timeout: 10_000 },
  );
  const logins = stdout.split("\n").filter(Boolean);

  // Also get repo contributors (recent, limited)
  try {
    const { stdout: contribOut } = await execFile(
      "gh",
      ["api", "repos/{owner}/{repo}/contributors", "--jq", ".[].login", "-q", "--paginate"],
      { cwd, timeout: 10_000 },
    );
    const repoContribs = contribOut.split("\n").filter(Boolean).slice(0, 30);
    const all = new Set([...logins, ...repoContribs]);
    return [...all].sort();
  } catch {
    return logins.sort();
  }
}

// ---------------------------------------------------------------------------
// Issues + PRs list (for # autocomplete)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// User search (for @ mention — search all of GitHub)
// ---------------------------------------------------------------------------

export async function searchUsers(
  cwd: string,
  query: string,
): Promise<Array<{ login: string; name: string | null }>> {
  if (!query || query.length < 2) {
    return [];
  }
  try {
    const { stdout } = await execFile(
      "gh",
      [
        "api",
        `search/users?q=${encodeURIComponent(query)}&per_page=8`,
        "--jq",
        ".items[] | {login: .login, name: .name}",
      ],
      { cwd, timeout: 8_000 },
    );
    // gh --jq outputs one JSON object per line (not an array)
    const lines = stdout.trim().split("\n").filter(Boolean);
    return lines.map((line) => {
      const parsed = JSON.parse(line) as { login: string; name: string | null };
      return parsed;
    });
  } catch {
    return [];
  }
}

export async function listIssuesAndPrs(
  cwd: string,
  limit = 50,
): Promise<Array<{ number: number; title: string; state: string; isPr: boolean }>> {
  // Fetch recent issues (includes PRs on GitHub)
  const { stdout } = await execFile(
    "gh",
    ["issue", "list", "--json", "number,title,state", "--limit", String(limit), "--state", "all"],
    { cwd, timeout: 15_000 },
  );
  const issues = parseJsonOutput<Array<{ number: number; title: string; state: string }>>(stdout);

  // Also fetch PRs (since gh issue list may not include all PRs)
  const { stdout: prOut } = await execFile(
    "gh",
    ["pr", "list", "--json", "number,title,state", "--limit", String(limit), "--state", "all"],
    { cwd, timeout: 15_000 },
  );
  const prs = parseJsonOutput<Array<{ number: number; title: string; state: string }>>(prOut);

  // Merge and dedupe
  const seen = new Set<number>();
  const result: Array<{ number: number; title: string; state: string; isPr: boolean }> = [];

  for (const pr of prs) {
    if (!seen.has(pr.number)) {
      seen.add(pr.number);
      result.push({ ...pr, isPr: true });
    }
  }
  for (const issue of issues) {
    if (!seen.has(issue.number)) {
      seen.add(issue.number);
      result.push({ ...issue, isPr: false });
    }
  }

  result.sort((a, b) => b.number - a.number);
  return result;
}

export async function resolveReviewThread(cwd: string, threadId: string): Promise<void> {
  await execFile(
    "gh",
    [
      "api",
      "graphql",
      "-f",
      `query=mutation { resolveReviewThread(input: { threadId: "${threadId}" }) { thread { isResolved } } }`,
    ],
    { cwd, timeout: 10_000 },
  );
}

export async function unresolveReviewThread(cwd: string, threadId: string): Promise<void> {
  await execFile(
    "gh",
    [
      "api",
      "graphql",
      "-f",
      `query=mutation { unresolveReviewThread(input: { threadId: "${threadId}" }) { thread { isResolved } } }`,
    ],
    { cwd, timeout: 10_000 },
  );
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

export async function listWorkflows(cwd: string): Promise<GhWorkflow[]> {
  const { stdout } = await execFile(
    "gh",
    ["workflow", "list", "--json", "id,name,state", "--limit", "50"],
    { cwd },
  );
  return parseJsonOutput<GhWorkflow[]>(stdout);
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

// ---------------------------------------------------------------------------
// Multi-repo (3.1)
// ---------------------------------------------------------------------------

export async function listAllPrs(
  workspaces: Array<{ path: string; name: string }>,
  filter: "reviewRequested" | "authored" | "all",
): Promise<Array<GhPrListItem & { workspace: string; workspacePath: string }>> {
  const results = await Promise.allSettled(
    workspaces.map(async (ws) => {
      const prs = await listPrs(ws.path, filter);
      return prs.map((pr) => ({ ...pr, workspace: ws.name, workspacePath: ws.path }));
    }),
  );

  return results
    .filter(
      (
        r,
      ): r is PromiseFulfilledResult<
        Array<GhPrListItem & { workspace: string; workspacePath: string }>
      > => r.status === "fulfilled",
    )
    .flatMap((r) => r.value);
}

// ---------------------------------------------------------------------------
// Metrics (3.2)
// ---------------------------------------------------------------------------

export async function getPrCycleTime(
  cwd: string,
  since: string,
): Promise<
  Array<{
    prNumber: number;
    title: string;
    author: string;
    createdAt: string;
    mergedAt: string | null;
    firstReviewAt: string | null;
    timeToFirstReview: number | null;
    timeToMerge: number | null;
    additions: number;
    deletions: number;
  }>
> {
  const { stdout } = await execFile(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "merged",
      "--json",
      "number,title,author,createdAt,mergedAt,additions,deletions,reviews",
      "--limit",
      "100",
    ],
    { cwd, timeout: 30_000 },
  );

  const prs = parseJsonOutput<
    Array<{
      number: number;
      title: string;
      author: { login: string };
      createdAt: string;
      mergedAt: string | null;
      additions: number;
      deletions: number;
      reviews: Array<{ submittedAt: string }>;
    }>
  >(stdout);

  const sinceDate = new Date(since);

  return prs
    .filter((pr) => new Date(pr.createdAt) >= sinceDate)
    .map((pr) => {
      const firstReview = pr.reviews
        .map((r) => new Date(r.submittedAt))
        .sort((a, b) => a.getTime() - b.getTime())[0];

      const createdMs = new Date(pr.createdAt).getTime();
      const mergedMs = pr.mergedAt ? new Date(pr.mergedAt).getTime() : null;
      const firstReviewMs = firstReview ? firstReview.getTime() : null;

      return {
        prNumber: pr.number,
        title: pr.title,
        author: pr.author.login,
        createdAt: pr.createdAt,
        mergedAt: pr.mergedAt,
        firstReviewAt: firstReview?.toISOString() ?? null,
        timeToFirstReview: firstReviewMs ? Math.round((firstReviewMs - createdMs) / 60_000) : null,
        timeToMerge: mergedMs ? Math.round((mergedMs - createdMs) / 60_000) : null,
        additions: pr.additions,
        deletions: pr.deletions,
      };
    });
}

export async function getReviewLoad(
  cwd: string,
  since: string,
): Promise<Array<{ reviewer: string; reviewCount: number; avgResponseTime: number }>> {
  const { stdout } = await execFile(
    "gh",
    ["pr", "list", "--state", "all", "--json", "number,createdAt,reviews", "--limit", "100"],
    { cwd, timeout: 30_000 },
  );

  const prs = parseJsonOutput<
    Array<{
      number: number;
      createdAt: string;
      reviews: Array<{ author: { login: string }; submittedAt: string }>;
    }>
  >(stdout);

  const sinceDate = new Date(since);
  const reviewerMap = new Map<string, { count: number; totalResponseMs: number }>();

  for (const pr of prs) {
    if (new Date(pr.createdAt) < sinceDate) {
      continue;
    }
    const prCreated = new Date(pr.createdAt).getTime();
    for (const review of pr.reviews) {
      const reviewer = review.author.login;
      const existing = reviewerMap.get(reviewer) ?? { count: 0, totalResponseMs: 0 };
      existing.count++;
      existing.totalResponseMs += new Date(review.submittedAt).getTime() - prCreated;
      reviewerMap.set(reviewer, existing);
    }
  }

  return [...reviewerMap.entries()]
    .map(([reviewer, data]) => ({
      reviewer,
      reviewCount: data.count,
      avgResponseTime: Math.round(data.totalResponseMs / data.count / 60_000),
    }))
    .sort((a, b) => b.reviewCount - a.reviewCount);
}

// ---------------------------------------------------------------------------
// Releases (3.4)
// ---------------------------------------------------------------------------

/**
 * Get the upstream repo identifier for gh commands that don't auto-detect forks.
 * Returns ["-R", "owner/repo"] args if fork, empty array if not.
 */
async function getUpstreamArgs(cwd: string): Promise<string[]> {
  try {
    const info = await getRepoInfo(cwd);
    if (info.isFork && info.parent) {
      return ["-R", info.parent];
    }
  } catch {
    // Not a fork or detection failed
  }
  return [];
}

export async function listReleases(
  cwd: string,
  limit = 20,
): Promise<
  Array<{
    tagName: string;
    name: string;
    body: string;
    isDraft: boolean;
    isPrerelease: boolean;
    createdAt: string;
    author: { login: string };
  }>
> {
  const upstreamArgs = await getUpstreamArgs(cwd);
  // gh release list only supports: createdAt, isDraft, isLatest, isPrerelease, name, publishedAt, tagName
  const { stdout } = await execFile(
    "gh",
    [
      ...upstreamArgs,
      "release",
      "list",
      "--json",
      "tagName,name,isDraft,isPrerelease,createdAt",
      "--limit",
      String(limit),
    ],
    { cwd, timeout: 15_000 },
  );
  const releases = parseJsonOutput<
    Array<{
      tagName: string;
      name: string;
      isDraft: boolean;
      isPrerelease: boolean;
      createdAt: string;
    }>
  >(stdout);

  // Fetch body + author per release via gh release view
  const detailed = await Promise.all(
    releases.map(async (release) => {
      try {
        const { stdout: detail } = await execFile(
          "gh",
          [...upstreamArgs, "release", "view", release.tagName, "--json", "body,author"],
          { cwd, timeout: 10_000 },
        );
        const data = parseJsonOutput<{ body: string; author: { login: string } }>(detail);
        return { ...release, body: data.body ?? "", author: data.author ?? { login: "" } };
      } catch {
        return { ...release, body: "", author: { login: "" } };
      }
    }),
  );

  return detailed;
}

export async function createRelease(args: {
  cwd: string;
  tagName: string;
  name: string;
  body: string;
  isDraft: boolean;
  isPrerelease: boolean;
  target: string;
}): Promise<{ url: string }> {
  const ghArgs = [
    "release",
    "create",
    args.tagName,
    "--title",
    args.name,
    "--notes",
    args.body,
    "--target",
    args.target,
  ];
  if (args.isDraft) {
    ghArgs.push("--draft");
  }
  if (args.isPrerelease) {
    ghArgs.push("--prerelease");
  }
  const { stdout } = await execFile("gh", ghArgs, { cwd: args.cwd, timeout: 30_000 });
  return { url: stdout.trim() };
}

export async function generateChangelog(cwd: string, sinceTag: string): Promise<string> {
  // Get merged PRs since the tag
  const { stdout: tagDate } = await execFile(
    "gh",
    ["release", "view", sinceTag, "--json", "createdAt", "--jq", ".createdAt"],
    { cwd, timeout: 10_000 },
  );

  const { stdout } = await execFile(
    "gh",
    ["pr", "list", "--state", "merged", "--json", "number,title,author,mergedAt", "--limit", "100"],
    { cwd, timeout: 15_000 },
  );

  const prs =
    parseJsonOutput<
      Array<{ number: number; title: string; author: { login: string }; mergedAt: string }>
    >(stdout);

  const since = new Date(tagDate.trim());
  const relevantPrs = prs
    .filter((pr) => new Date(pr.mergedAt) > since)
    .sort((a, b) => new Date(a.mergedAt).getTime() - new Date(b.mergedAt).getTime());

  if (relevantPrs.length === 0) {
    return "No changes since last release.";
  }

  return relevantPrs.map((pr) => `- ${pr.title} (#${pr.number}) @${pr.author.login}`).join("\n");
}
