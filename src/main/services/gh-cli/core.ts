/* eslint-disable no-await-in-loop, no-continue, prefer-destructuring, init-declarations, @typescript-eslint/no-non-null-assertion -- This adapter is an explicit command-mapping layer where linear control flow is more important than these stylistic constraints. */
import type {
  GhAccount,
  GhAvatarLookup,
  GhPrEnrichment,
  GhPrListItem,
  GhPrListItemCore,
  GhUser,
  RepoInfo,
} from "../../../shared/ipc";

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

export async function ghExec(
  args: string[],
  options: { cwd?: string; timeout?: number } = {},
): Promise<ExecResult> {
  try {
    return await execFile("gh", args, options);
  } catch (error) {
    const subcommand = args[0] ?? "unknown";
    const category = categoriseGhError(error);
    trackFromMain("gh_cli_error", { subcommand, category });
    throw error;
  }
}

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
  cwd: string,
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
          { cwd, timeout: 10_000 },
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

export async function getOwnerRepo(cwd: string): Promise<{ owner: string; repo: string }> {
  const { stdout } = await execFile("git", ["remote", "get-url", "origin"], {
    cwd,
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

export async function getPullRequestRepoFullName(cwd: string): Promise<string> {
  try {
    const info = await getRepoInfo(cwd);
    return info.isFork && info.parent ? info.parent : info.nameWithOwner;
  } catch {
    const { owner, repo } = await getOwnerRepo(cwd);
    return `${owner}/${repo}`;
  }
}

export async function getPullRequestRepo(cwd: string): Promise<{ owner: string; repo: string }> {
  return parseRepoFullName(await getPullRequestRepoFullName(cwd));
}

export async function getRepoHost(cwd: string): Promise<string | null> {
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

export async function getRepoInfo(cwd: string): Promise<RepoInfo> {
  const { stdout } = await ghExec(
    ["repo", "view", "--json", "nameWithOwner,isFork,parent,viewerPermission,defaultBranchRef"],
    { cwd, timeout: 10_000 },
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
      { cwd, timeout: 10_000 },
    );
    const gql = JSON.parse(gqlOut) as {
      data?: { repository?: { mergeQueue?: { id: string } | null } };
    };
    const mergeQueue = gql.data?.repository?.mergeQueue;
    hasMergeQueue = mergeQueue !== null && mergeQueue !== undefined;
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

export const CACHE_TTL_MS = 15_000;
export const CACHE_TTL_LONG_MS = 60_000;

export function cacheKey({
  cwd,
  filter,
  state = "open",
  limit = resolvePrListLimit(),
}: {
  cwd: string;
  filter: string;
  state?: string;
  limit?: string;
}): string {
  return `${cwd}::${filter}::${state}::${limit}`;
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

export function invalidatePrListCaches(cwd: string): void {
  for (const filter of ["reviewRequested", "authored", "all"] as const) {
    for (const state of ["open", "closed", "merged", "all"] as const) {
      const key = cacheKey({ cwd, filter, state });
      invalidateCacheKey(prListCache, key);
      invalidateCacheKey(prEnrichmentCache, key);
      invalidateCacheKey(prFullCache, key);
    }
  }
}

export function invalidateWorkflowCaches(cwd: string): void {
  invalidateCacheWhere(
    genericCache,
    (key) => key.startsWith(`workflows::${cwd}`) || key.startsWith(`workflowRuns::${cwd}::`),
  );
}

export function invalidateReleaseCaches(cwd: string): void {
  invalidateCacheWhere(genericCache, (key) => key.startsWith(`releases::${cwd}::`));
}

export function invalidateAllCaches(): void {
  clearCacheStore(prListCache);
  clearCacheStore(prEnrichmentCache);
  clearCacheStore(prFullCache);
  clearCacheStore(genericCache);
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

export async function getUpstreamArgs(cwd: string): Promise<string[]> {
  try {
    const info = await getRepoInfo(cwd);
    if (info.isFork && info.parent) {
      return ["-R", info.parent];
    }
  } catch {
    // Not a fork or detection failed.
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
