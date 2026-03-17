import { exec, whichVersion } from "./shell";

/**
 * GitHub CLI (`gh`) adapter.
 *
 * All data fetching from GitHub goes through this service.
 * It shells out to `gh` which uses the user's existing auth token.
 */

export async function getGhVersion(): Promise<string | null> {
  return whichVersion("gh");
}

export async function isGhAuthenticated(): Promise<boolean> {
  try {
    await exec("gh auth status", { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** Raw JSON output from `gh` commands. */
function parseJsonOutput<T>(stdout: string): T {
  return JSON.parse(stdout) as T;
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
  const flag = filter === "reviewRequested" ? "--search 'review-requested:@me'" : "--author @me";
  const { stdout } = await exec(
    `gh pr list ${flag} --json ${PR_LIST_FIELDS} --limit 50`,
    { cwd },
  );
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
  const { stdout } = await exec(
    `gh pr view ${prNumber} --json ${PR_DETAIL_FIELDS}`,
    { cwd },
  );
  return parseJsonOutput<GhPrDetail>(stdout);
}

// ---------------------------------------------------------------------------
// PR diff
// ---------------------------------------------------------------------------

export async function getPrDiff(cwd: string, prNumber: number): Promise<string> {
  const { stdout } = await exec(`gh pr diff ${prNumber}`, { cwd });
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
  const { stdout } = await exec(
    `gh pr checks ${prNumber} --json name,status,conclusion,detailsUrl,startedAt,completedAt`,
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
  const { stdout } = await exec(`gh run view ${runId} --log`, { cwd, timeout: 60_000 });
  return stdout;
}

export async function rerunFailedJobs(cwd: string, runId: number): Promise<void> {
  await exec(`gh run rerun ${runId} --failed`, { cwd });
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
  await exec(`gh pr merge ${prNumber} --${strategy} --delete-branch`, { cwd });
}
