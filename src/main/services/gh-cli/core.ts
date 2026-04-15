/* eslint-disable no-await-in-loop, no-continue, prefer-destructuring, init-declarations, @typescript-eslint/no-non-null-assertion -- This adapter is an explicit command-mapping layer where linear control flow is more important than these stylistic constraints. */
import type {
  GhAccount,
  GhAvatarLookup,
  GhRepoContributionHistory,
  GhPrEnrichment,
  GhPrListItem,
  GhPrListItemCore,
  GhUser,
  GhUserProfile,
  RepoInfo,
  RepoTarget,
} from "../../../shared/ipc";
import type { GhRepoSearchResult } from "../../../shared/ipc/contracts/environment";

import {
  PR_FETCH_LIMIT_PREFERENCE_KEY,
  normalizePrFetchLimit,
} from "../../../shared/pr-fetch-limit";
import { cacheDisplayNames, getPreference } from "../../db/repository";
import { trackFromMain } from "../analytics";
import { type ExecResult, execFile } from "../shell";

/**
 * Shared gh CLI primitives used across the service's domain modules.
 * This file owns command execution, caching, repo resolution, and list-filter helpers.
 */

function categoriseGhError(error: unknown): string {
  const msg = String((error as Error)?.message ?? "");
  if (msg.includes("ETIMEDOUT") || msg.includes("ESOCKETTIMEDOUT") || msg.includes("timeout")) {
    return "timeout";
  }
  if (msg.includes("auth") || msg.includes("401") || msg.includes("403")) {
    return "auth";
  }
  if (msg.includes("404") || msg.includes("not found") || msg.includes("Could not resolve")) {
    return "not_found";
  }
  if (msg.includes("rate limit") || msg.includes("429")) {
    return "rate_limit";
  }
  if (msg.includes("ENOENT")) {
    return "not_installed";
  }
  if (msg.includes("no checks reported")) {
    return "empty_checks";
  }
  return "unknown";
}

const GH_API_MIN_TIMEOUT_MS = 120_000;

function resolveGhExecTimeout(
  args: string[],
  requestedTimeout: number | undefined,
): number | undefined {
  if (args[0] !== "api") {
    return requestedTimeout;
  }

  return Math.max(requestedTimeout ?? 0, GH_API_MIN_TIMEOUT_MS);
}

export async function ghExec(
  args: string[],
  options: { cwd?: string; timeout?: number } = {},
): Promise<ExecResult> {
  try {
    return await execFile("gh", args, {
      ...options,
      timeout: resolveGhExecTimeout(args, options.timeout),
    });
  } catch (error) {
    const subcommand = args[0] ?? "unknown";
    const category = categoriseGhError(error);
    trackFromMain("gh_cli_error", { subcommand, category });
    throw error;
  }
}

/**
 * Resolve a RepoTarget to gh CLI execution options.
 * When a local path is available, uses it as cwd (gh auto-detects repo from git remote).
 * When no local path, uses `-R owner/repo` flag instead.
 */
export function resolveRepoCwd(target: RepoTarget): {
  cwd?: string;
  repoFlag: string[];
  nwo: string;
} {
  const nwo = `${target.owner}/${target.repo}`;
  if (target.cwd) {
    return { cwd: target.cwd, repoFlag: [], nwo };
  }
  return { repoFlag: ["-R", nwo], nwo };
}

/**
 * Resolve a string path or RepoTarget to gh CLI execution options.
 * When given a plain string (local repo path), uses it as cwd with no -R flag.
 * When given a RepoTarget, delegates to resolveRepoCwd.
 */
export function resolveTarget(cwdOrTarget: string | RepoTarget): {
  cwd?: string;
  repoFlag: string[];
  nwo: string;
} {
  return typeof cwdOrTarget === "string"
    ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
    : resolveRepoCwd(cwdOrTarget);
}

export { type RepoTarget } from "../../../shared/ipc";

export async function getAuthenticatedUser(): Promise<GhUser | null> {
  try {
    const { stdout } = await ghExec(
      ["api", "user", "--jq", "{login: .login, avatarUrl: .avatar_url, name: .name}"],
      { timeout: 10_000 },
    );
    return parseJsonOutput<GhUser>(stdout);
  } catch {
    return null;
  }
}

async function getRepoContributionHistory(
  login: string,
  repo: string,
  repoTarget?: RepoTarget,
  currentPrNumber?: number,
): Promise<GhRepoContributionHistory> {
  const normalizedLogin = login.trim().toLowerCase();
  const normalizedRepo = repo.trim().toLowerCase();
  const cacheKey = `userRepoContributions::${normalizedRepo}::${normalizedLogin}::${currentPrNumber ?? "all"}`;

  return getOrLoadCached({
    cache: genericCache,
    key: cacheKey,
    ttl: CACHE_TTL_LONG_MS,
    loader: async () => {
      const resolved = repoTarget ? resolveTarget(repoTarget) : { cwd: undefined };
      const query = `query(
        $authoredPullRequestsQuery: String!
        $mergedPullRequestsQuery: String!
        $authoredIssuesQuery: String!
        $reviewedPullRequestsQuery: String!
      ) {
        authoredPullRequests: search(
          type: ISSUE
          query: $authoredPullRequestsQuery
          first: 1
        ) {
          issueCount
        }
        mergedPullRequests: search(
          type: ISSUE
          query: $mergedPullRequestsQuery
          first: 1
        ) {
          issueCount
        }
        authoredIssues: search(
          type: ISSUE
          query: $authoredIssuesQuery
          first: 1
        ) {
          issueCount
        }
        reviewedPullRequests: search(
          type: ISSUE
          query: $reviewedPullRequestsQuery
          first: 1
        ) {
          issueCount
        }
      }`;

      const { stdout } = await ghExec(
        [
          "api",
          "graphql",
          "-f",
          `authoredPullRequestsQuery=repo:${repo} is:pr author:${login}`,
          "-f",
          `mergedPullRequestsQuery=repo:${repo} is:pr is:merged author:${login}`,
          "-f",
          `authoredIssuesQuery=repo:${repo} is:issue author:${login}`,
          "-f",
          `reviewedPullRequestsQuery=repo:${repo} is:pr reviewed-by:${login}`,
          "-f",
          `query=${query}`,
        ],
        { cwd: resolved.cwd, timeout: 15_000 },
      );
      const data = parseJsonOutput<{
        data?: {
          authoredPullRequests?: { issueCount?: number };
          mergedPullRequests?: { issueCount?: number };
          authoredIssues?: { issueCount?: number };
          reviewedPullRequests?: { issueCount?: number };
        };
      }>(stdout);

      const authoredPullRequests = Math.max(
        0,
        (data.data?.authoredPullRequests?.issueCount ?? 0) - (currentPrNumber ? 1 : 0),
      );
      const mergedPullRequests = data.data?.mergedPullRequests?.issueCount ?? 0;
      const issues = data.data?.authoredIssues?.issueCount ?? 0;
      const reviewedPullRequests = data.data?.reviewedPullRequests?.issueCount ?? 0;

      return {
        repo,
        pullRequests: authoredPullRequests,
        mergedPullRequests,
        issues,
        reviewedPullRequests,
        total: authoredPullRequests + issues + reviewedPullRequests,
      };
    },
  }) as Promise<GhRepoContributionHistory>;
}

export async function getUserProfile(
  login: string,
  repo?: string | RepoTarget,
  currentPrNumber?: number,
): Promise<GhUserProfile> {
  const jq = [
    "{",
    "login: .login,",
    "name: .name,",
    "avatarUrl: .avatar_url,",
    "bio: .bio,",
    "company: .company,",
    "location: .location,",
    "followers: .followers,",
    "following: .following,",
    "publicRepos: .public_repos,",
    "createdAt: .created_at,",
    "}",
  ].join(" ");

  const { stdout } = await ghExec(["api", `users/${encodeURIComponent(login)}`, "--jq", jq], {
    timeout: 15_000,
  });
  const profile =
    parseJsonOutput<Omit<GhUserProfile, "organizations" | "repoContributions">>(stdout);

  // Fetch organizations separately.
  // The public endpoint (users/{login}/orgs) only returns public memberships.
  // For the authenticated user, use the authenticated endpoint (user/orgs)
  // Which includes private org memberships.
  let organizations: GhUserProfile["organizations"] = [];
  try {
    const viewer = await getAuthenticatedUser();
    const orgEndpoint =
      viewer && viewer.login.toLowerCase() === login.toLowerCase()
        ? "user/orgs"
        : `users/${encodeURIComponent(login)}/orgs`;

    const { stdout: orgStdout } = await ghExec(
      ["api", orgEndpoint, "--jq", "[.[] | {login: .login, avatarUrl: .avatar_url}]"],
      { timeout: 10_000 },
    );
    organizations = parseJsonOutput<GhUserProfile["organizations"]>(orgStdout);
  } catch {
    // Org fetch can fail for bots or private orgs — non-critical
  }

  let repoContributions: GhUserProfile["repoContributions"] = null;
  if (repo) {
    try {
      repoContributions =
        typeof repo === "string"
          ? await getRepoContributionHistory(login, repo, undefined, currentPrNumber)
          : await getRepoContributionHistory(
              login,
              `${repo.owner}/${repo.repo}`,
              repo,
              currentPrNumber,
            );
    } catch {
      // Contribution history is best-effort. Profile data remains useful without it.
    }
  }

  return { ...profile, organizations, repoContributions };
}

export async function listAccounts(): Promise<GhAccount[]> {
  try {
    const { stdout } = await ghExec(["auth", "status", "--json", "hosts"], {
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

function normalizeGitHubHost(host: string): string {
  return host
    .trim()
    .replace(/^https?:\/\//u, "")
    .replace(/\/+$/u, "");
}

export function getAvatarUrl(
  cwd: string | null,
  login: string,
  host: string,
): Promise<GhAvatarLookup | null> {
  const normalizedHost = normalizeGitHubHost(host);
  const normalizedLogin = login.trim();

  if (!normalizedHost || !normalizedLogin) {
    return Promise.resolve(null);
  }

  const key = `avatarUrl::${normalizedHost}::${normalizedLogin.toLowerCase()}`;
  return getOrLoadCached({
    cache: genericCache,
    key,
    ttl: CACHE_TTL_LONG_MS,
    loader: async () => {
      try {
        const { stdout } = await ghExec(
          [
            "api",
            "--hostname",
            normalizedHost,
            `users/${encodeURIComponent(normalizedLogin)}`,
            "--jq",
            "{login: .login, avatarUrl: .avatar_url}",
          ],
          { cwd: cwd ?? undefined, timeout: 10_000 },
        );
        const data = parseJsonOutput<{ login: string; avatarUrl: string | null }>(stdout);

        return {
          login: data.login,
          host: normalizedHost,
          avatarUrl: data.avatarUrl,
        } satisfies GhAvatarLookup;
      } catch {
        return null;
      }
    },
  }) as Promise<GhAvatarLookup | null>;
}

export async function switchAccount(host: string, login: string): Promise<void> {
  await ghExec(["auth", "switch", "--hostname", host, "--user", login], {
    timeout: 10_000,
  });
  invalidateAllCaches();
}

export async function getOwnerRepo(
  cwdOrTarget: string | RepoTarget,
): Promise<{ owner: string; repo: string }> {
  if (typeof cwdOrTarget !== "string") {
    return { owner: cwdOrTarget.owner, repo: cwdOrTarget.repo };
  }
  const { stdout } = await execFile("git", ["remote", "get-url", "origin"], {
    cwd: cwdOrTarget,
    timeout: 5000,
  });
  const url = stdout.trim();
  const match = url.match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Could not parse owner/repo from remote URL: ${url}`);
  }
  return { owner: match[1]!, repo: match[2]! };
}

export function parseRepoFullName(repoFullName: string): { owner: string; repo: string } {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Could not parse owner/repo from repo name: ${repoFullName}`);
  }
  return { owner, repo };
}

export async function getPullRequestRepoFullName(
  cwdOrTarget: string | RepoTarget,
): Promise<string> {
  try {
    const info = await getRepoInfo(cwdOrTarget);
    return info.isFork && info.parent ? info.parent : info.nameWithOwner;
  } catch {
    const { owner, repo } = await getOwnerRepo(cwdOrTarget);
    return `${owner}/${repo}`;
  }
}

export async function getPullRequestRepo(
  cwdOrTarget: string | RepoTarget,
): Promise<{ owner: string; repo: string }> {
  return parseRepoFullName(await getPullRequestRepoFullName(cwdOrTarget));
}

export async function getRepoHost(cwdOrTarget: string | RepoTarget): Promise<string | null> {
  const cwd = typeof cwdOrTarget === "string" ? cwdOrTarget : cwdOrTarget.cwd;
  if (!cwd) {
    // Remote-only workspace — default to github.com
    return "github.com";
  }
  try {
    const { stdout } = await execFile("git", ["remote", "get-url", "origin"], {
      cwd,
      timeout: 5000,
    });
    const url = stdout.trim();
    const httpsMatch = url.match(/^https?:\/\/([^/:]+)/);
    if (httpsMatch?.[1]) {
      return httpsMatch[1];
    }
    const sshMatch = url.match(/^(?:ssh:\/\/)?[^@]+@([^:/]+)/);
    if (sshMatch?.[1]) {
      return sshMatch[1];
    }
  } catch {
    // No remote or git not available.
  }
  return null;
}

export function getRepoInfo(cwdOrTarget: string | RepoTarget): Promise<RepoInfo> {
  const resolved = resolveTarget(cwdOrTarget);
  const cacheKey = `repoInfo::${resolved.cwd ?? resolved.nwo}`;

  return getOrLoadCached({
    cache: repoInfoCache,
    key: cacheKey,
    ttl: REPO_INFO_CACHE_TTL_MS,
    loader: async () => {
      const { stdout } = await ghExec(
        [
          "repo",
          "view",
          ...resolved.repoFlag,
          "--json",
          "nameWithOwner,isFork,parent,viewerPermission,defaultBranchRef",
        ],
        { cwd: resolved.cwd, timeout: 10_000 },
      );
      const data = parseJsonOutput<{
        nameWithOwner: string;
        isFork: boolean;
        parent: { owner: { login: string }; name: string } | null;
        viewerPermission: string;
        defaultBranchRef: { name: string } | null;
      }>(stdout);
      const canPush = ["ADMIN", "MAINTAIN", "WRITE"].includes(data.viewerPermission);

      let hasMergeQueue = false;
      try {
        const mergeQueueRepo =
          data.isFork && data.parent
            ? { owner: data.parent.owner.login, repo: data.parent.name }
            : parseRepoFullName(data.nameWithOwner);
        const { owner, repo } = mergeQueueRepo;
        const defaultBranch = data.defaultBranchRef?.name ?? "main";
        const { stdout: gqlOut } = await ghExec(
          [
            "api",
            "graphql",
            "-f",
            `owner=${owner}`,
            "-f",
            `repo=${repo}`,
            "-f",
            `branch=${defaultBranch}`,
            "-f",
            `query=query($owner: String!, $repo: String!, $branch: String!) { repository(owner: $owner, name: $repo) { mergeQueue(branch: $branch) { id } } }`,
          ],
          { cwd: resolved.cwd, timeout: 10_000 },
        );
        const gql = JSON.parse(gqlOut) as {
          data?: { repository?: { mergeQueue?: { id: string } | null } };
        };
        const mergeQueue = gql.data?.repository?.mergeQueue;
        hasMergeQueue = mergeQueue != null;
      } catch {
        // Merge queue query failed (e.g. GHES without merge queue support).
      }

      return {
        nameWithOwner: data.nameWithOwner,
        isFork: data.isFork,
        parent: data.parent ? `${data.parent.owner.login}/${data.parent.name}` : null,
        canPush,
        hasMergeQueue,
      };
    },
  });
}

export async function isGhAuthenticated(): Promise<boolean> {
  try {
    await ghExec(["auth", "status"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export function parseJsonOutput<T>(stdout: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [] as unknown as T;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
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

export const PR_LIST_CORE_FIELDS = [
  "number",
  "title",
  "state",
  "author",
  "headRefName",
  "baseRefName",
  "reviewDecision",
  "updatedAt",
  "url",
  "isDraft",
  "additions",
  "deletions",
].join(",");

export const PR_LIST_ENRICHMENT_FIELDS = [
  "number",
  "statusCheckRollup",
  "additions",
  "deletions",
  "mergeable",
  "autoMergeRequest",
].join(",");

export const PR_LIST_ALL_FIELDS = [
  PR_LIST_CORE_FIELDS,
  "statusCheckRollup",
  "additions",
  "deletions",
  "mergeable",
  "autoMergeRequest",
].join(",");

export const PR_LIST_SLIM = [
  "number",
  "title",
  "state",
  "author",
  "headRefName",
  "updatedAt",
  "isDraft",
].join(",");
const REPO_INFO_CACHE_TTL_MS = 300_000;

export function resolvePrListLimit(): string {
  return String(normalizePrFetchLimit(getPreference(PR_FETCH_LIMIT_PREFERENCE_KEY)));
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export interface CacheStore<T> {
  entries: Map<string, CacheEntry<T>>;
  inFlight: Map<string, Promise<T>>;
  invalidationVersions: Map<string, number>;
  epoch: number;
}

function createCacheStore<T>(): CacheStore<T> {
  return {
    entries: new Map(),
    inFlight: new Map(),
    invalidationVersions: new Map(),
    epoch: 0,
  };
}

export const prListCache = createCacheStore<GhPrListItemCore[]>();
export const prEnrichmentCache = createCacheStore<GhPrEnrichment[]>();
export const prFullCache = createCacheStore<GhPrListItem[]>();
export const genericCache = createCacheStore<unknown>();
const repoInfoCache = createCacheStore<RepoInfo>();

const CACHE_TTL_MS = 15_000;
export const CACHE_TTL_LONG_MS = 60_000;

export function cacheKey({
  cwd,
  nwo,
  filter,
  state = "open",
  limit = resolvePrListLimit(),
}: {
  cwd?: string | null;
  nwo?: string;
  filter: string;
  state?: string;
  limit?: string;
}): string {
  const id = nwo ?? cwd ?? "unknown";
  return `${id}::${filter}::${state}::${limit}`;
}

function getCached<T>(cache: CacheStore<T>, key: string): T | null {
  const entry = cache.entries.get(key);
  if (entry && Date.now() < entry.expiresAt) {
    return entry.data;
  }
  cache.entries.delete(key);
  return null;
}

export function setCache<T>(
  cache: CacheStore<T>,
  key: string,
  value: { data: T; ttl?: number },
): void {
  cache.entries.set(key, {
    data: value.data,
    expiresAt: Date.now() + (value.ttl ?? CACHE_TTL_MS),
  });
}

export function invalidateCacheKey<T>(cache: CacheStore<T>, key: string): void {
  cache.entries.delete(key);
  cache.inFlight.delete(key);
  cache.invalidationVersions.set(key, (cache.invalidationVersions.get(key) ?? 0) + 1);
}

function invalidateCacheWhere<T>(cache: CacheStore<T>, predicate: (key: string) => boolean): void {
  const keys = new Set([
    ...cache.entries.keys(),
    ...cache.inFlight.keys(),
    ...cache.invalidationVersions.keys(),
  ]);

  for (const key of keys) {
    if (predicate(key)) {
      invalidateCacheKey(cache, key);
    }
  }
}

function clearCacheStore<T>(cache: CacheStore<T>): void {
  cache.entries.clear();
  cache.inFlight.clear();
  cache.invalidationVersions.clear();
  cache.epoch += 1;
}

export function getOrLoadCached<T>({
  cache,
  key,
  loader,
  ttl = CACHE_TTL_MS,
}: {
  cache: CacheStore<T>;
  key: string;
  loader: () => Promise<T>;
  ttl?: number;
}): Promise<T> {
  const cached = getCached(cache, key);
  if (cached !== null) {
    return Promise.resolve(cached);
  }

  const pending = cache.inFlight.get(key);
  if (pending) {
    return pending;
  }

  const { epoch, invalidationVersions } = cache;
  const invalidationVersion = invalidationVersions.get(key) ?? 0;

  const request = loader()
    .then((data) => {
      if (
        cache.epoch === epoch &&
        (cache.invalidationVersions.get(key) ?? 0) === invalidationVersion
      ) {
        setCache(cache, key, { data, ttl });
      }
      return data;
    })
    .finally(() => {
      if (cache.inFlight.get(key) === request) {
        cache.inFlight.delete(key);
      }
    });

  cache.inFlight.set(key, request);
  return request;
}

export function invalidatePrListCaches(id: string): void {
  for (const filter of ["reviewRequested", "authored", "all"] as const) {
    for (const state of ["open", "closed", "merged", "all"] as const) {
      const key = cacheKey({ nwo: id, filter, state });
      invalidateCacheKey(prListCache, key);
      invalidateCacheKey(prEnrichmentCache, key);
      invalidateCacheKey(prFullCache, key);
    }
  }
}

export function invalidateWorkflowCaches(id: string): void {
  invalidateCacheWhere(
    genericCache,
    (key) => key.startsWith(`workflows::${id}`) || key.startsWith(`workflowRuns::${id}::`),
  );
}

export function invalidateReleaseCaches(id: string): void {
  invalidateCacheWhere(genericCache, (key) => key.startsWith(`releases::${id}::`));
}

export function invalidateAllCaches(): void {
  clearCacheStore(prListCache);
  clearCacheStore(prEnrichmentCache);
  clearCacheStore(prFullCache);
  clearCacheStore(genericCache);
  clearCacheStore(repoInfoCache);
}

export function buildFilterArgs({
  filter,
  jsonFields,
  repoArgs = [],
  state = "open",
  limit = resolvePrListLimit(),
}: {
  filter: "reviewRequested" | "authored" | "all";
  jsonFields: string;
  repoArgs?: string[];
  state?: "open" | "closed" | "merged" | "all";
  limit?: string;
}): string[] {
  switch (filter) {
    case "reviewRequested": {
      return [
        "pr",
        "list",
        ...repoArgs,
        "--state",
        state,
        "--search",
        "review-requested:@me",
        "--json",
        jsonFields,
        "--limit",
        limit,
      ];
    }
    case "authored": {
      return [
        "pr",
        "list",
        ...repoArgs,
        "--state",
        state,
        "--author",
        "@me",
        "--json",
        jsonFields,
        "--limit",
        limit,
      ];
    }
    case "all": {
      return ["pr", "list", ...repoArgs, "--state", state, "--json", jsonFields, "--limit", limit];
    }
  }
}

export async function getUpstreamArgs(cwdOrTarget: string | RepoTarget): Promise<string[]> {
  try {
    const info = await getRepoInfo(cwdOrTarget);
    if (info.isFork && info.parent) {
      return ["-R", info.parent];
    }
  } catch {
    // Not a fork or detection failed.
  }
  // For remote-only workspaces with no fork, use -R owner/repo
  if (typeof cwdOrTarget !== "string" && !cwdOrTarget.cwd) {
    return ["-R", `${cwdOrTarget.owner}/${cwdOrTarget.repo}`];
  }
  return [];
}

export const MAX_CONCURRENT_GH_CALLS = 3;

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: Array<PromiseSettledResult<R> | undefined> = Array.from({ length: items.length });
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items.at(index);
      if (item === undefined) {
        return;
      }
      try {
        results[index] = { status: "fulfilled", value: await fn(item) };
      } catch (error) {
        results[index] = { status: "rejected", reason: error };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results.map(
    (result) =>
      result ?? {
        status: "rejected",
        reason: new Error("Missing concurrency result"),
      },
  );
}

export function cacheAuthorDisplayNames(prs: GhPrListItemCore[]): void {
  cacheDisplayNames(prs.map((pr) => ({ login: pr.author.login, name: pr.author.name ?? null })));
}

export async function searchRepos(query: string, limit = 30): Promise<GhRepoSearchResult[]> {
  const args = query.trim()
    ? [
        "search",
        "repos",
        query,
        "--json",
        "fullName,description,isPrivate",
        "--limit",
        String(limit),
      ]
    : ["repo", "list", "--json", "nameWithOwner,description,isPrivate", "--limit", String(limit)];

  const { stdout } = await ghExec(args, { timeout: 15_000 });

  if (query.trim()) {
    const results =
      parseJsonOutput<Array<{ fullName: string; description: string; isPrivate: boolean }>>(stdout);
    return results.map((r) => {
      const [owner = "", repo = ""] = r.fullName.split("/");
      return {
        owner,
        repo,
        fullName: r.fullName,
        description: r.description || null,
        isPrivate: r.isPrivate,
      };
    });
  }

  const results =
    parseJsonOutput<Array<{ nameWithOwner: string; description: string; isPrivate: boolean }>>(
      stdout,
    );
  return results.map((r) => {
    const [owner = "", repo = ""] = r.nameWithOwner.split("/");
    return {
      owner,
      repo,
      fullName: r.nameWithOwner,
      description: r.description || null,
      isPrivate: r.isPrivate,
    };
  });
}
