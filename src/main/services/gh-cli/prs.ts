/* eslint-disable max-params, no-await-in-loop, no-continue, prefer-destructuring, init-declarations, @typescript-eslint/no-non-null-assertion -- PR command mapping stays intentionally direct so the gh adapter remains easy to audit. */
import type {
  GhPrDetail,
  GhPrEnrichment,
  GhPrListItem,
  GhPrListItemCore,
  GhPrReactions,
  GhReactionContent,
  GhReactionGroup,
  GhReviewComment,
  RepoTarget,
} from "../../../shared/ipc";

import { PR_FETCH_LIMIT_UNLIMITED } from "../../../shared/pr-fetch-limit";
import {
  PR_LIST_CORE_FIELDS,
  PR_LIST_ENRICHMENT_FIELDS,
  buildFilterArgs,
  cacheAuthorDisplayNames,
  cacheKey,
  getOrLoadCached,
  getPullRequestRepo,
  getPullRequestRepoFullName,
  getUpstreamArgs,
  genericCache,
  ghExec,
  invalidateCacheKey,
  invalidatePrListCaches,
  parseJsonOutput,
  prEnrichmentCache,
  prFullCache,
  prListCache,
  resolveRepoCwd,
  resolvePrListLimit,
  setCache,
  PR_LIST_SLIM,
} from "./core";

const MAX_BROAD_ENRICHMENT_LIMIT = 100;
const MAX_ALL_STATE_ENRICHMENT_LIMIT = 50;
const UNLIMITED_PR_PAGE_SIZE = 100;

async function resolveOpenPullRequest(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
): Promise<{ cwd?: string; repoFlag: string[]; nwo: string }> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const { stdout } = await ghExec(
    ["pr", "view", String(prNumber), "--json", "state", "--jq", ".state", ...resolved.repoFlag],
    { cwd: resolved.cwd, timeout: 10_000 },
  );

  if (stdout.trim() !== "OPEN") {
    throw new Error("Review actions are unavailable for closed or merged pull requests.");
  }

  return resolved;
}

interface RawPullRequestAuthor {
  __typename: string;
  login?: string | null;
  name?: string | null;
}

interface RawCheckRunNode {
  __typename: "CheckRun";
  name: string;
  status: string;
  conclusion: string | null;
}

interface RawStatusContextNode {
  __typename: "StatusContext";
  context: string;
  state: string;
}

type RawStatusCheckNode = RawCheckRunNode | RawStatusContextNode | null;

interface RawPullRequestNode {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  author: RawPullRequestAuthor | null;
  headRefName: string;
  baseRefName: string;
  reviewDecision: string | null;
  updatedAt: string;
  url: string;
  isDraft: boolean;
  statusCheckRollup: {
    contexts: {
      nodes: RawStatusCheckNode[];
    };
  } | null;
  additions: number | null;
  deletions: number | null;
  mergeable: string | null;
  autoMergeRequest: {
    enabledBy: { login: string } | null;
    mergeMethod: string;
  } | null;
}

interface RawPullRequestCoreNode {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  author: RawPullRequestAuthor | null;
  headRefName: string;
  baseRefName: string;
  reviewDecision: string | null;
  updatedAt: string;
  url: string;
  isDraft: boolean;
  additions: number | null;
  deletions: number | null;
}

interface RawPullRequestEnrichmentNode {
  number: number;
  statusCheckRollup: RawPullRequestNode["statusCheckRollup"];
  additions: number | null;
  deletions: number | null;
  mergeable: string | null;
  autoMergeRequest: RawPullRequestNode["autoMergeRequest"];
}

const UNLIMITED_PULL_REQUEST_CORE_FIELDS = `
  number
  title
  state
  author {
    __typename
    login
    ... on User { name }
    ... on Mannequin { name }
  }
  headRefName
  baseRefName
  reviewDecision
  updatedAt
  url
  isDraft
  additions
  deletions
`;

const UNLIMITED_PULL_REQUEST_ENRICHMENT_FIELDS = `
  number
  statusCheckRollup {
    contexts(first: 100) {
      nodes {
        __typename
        ... on CheckRun { name status conclusion }
        ... on StatusContext { context state }
      }
    }
  }
  additions
  deletions
  mergeable
  autoMergeRequest {
    enabledBy { login }
    mergeMethod
  }
`;

const UNLIMITED_PULL_REQUEST_FIELDS = `
  ${UNLIMITED_PULL_REQUEST_CORE_FIELDS}
  ${UNLIMITED_PULL_REQUEST_ENRICHMENT_FIELDS}
`;

function mapPullRequestAuthor(author: RawPullRequestAuthor | null): GhPrListItem["author"] {
  return {
    login: author?.login ?? "ghost",
    name: author?.name ?? null,
  };
}

function mapStatusCheckRollup(
  statusCheckRollup: RawPullRequestNode["statusCheckRollup"],
): GhPrListItem["statusCheckRollup"] {
  return (statusCheckRollup?.contexts.nodes ?? []).flatMap((node) => {
    if (!node) {
      return [];
    }

    if (node.__typename === "CheckRun") {
      return [
        {
          name: node.name,
          status: node.status,
          conclusion: node.conclusion,
        },
      ];
    }

    const normalizedState = node.state.toUpperCase();
    const isPendingState = normalizedState === "EXPECTED" || normalizedState === "PENDING";

    return [
      {
        name: node.context,
        status: isPendingState ? normalizedState : "COMPLETED",
        conclusion: isPendingState ? null : normalizedState,
      },
    ];
  });
}

function mapRawPullRequest(pr: RawPullRequestNode): GhPrListItem {
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    author: mapPullRequestAuthor(pr.author),
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
    reviewDecision: pr.reviewDecision ?? "",
    statusCheckRollup: mapStatusCheckRollup(pr.statusCheckRollup),
    updatedAt: pr.updatedAt,
    url: pr.url,
    isDraft: pr.isDraft,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    mergeable: pr.mergeable ?? "UNKNOWN",
    autoMergeRequest:
      pr.autoMergeRequest && pr.autoMergeRequest.enabledBy
        ? {
            enabledBy: { login: pr.autoMergeRequest.enabledBy.login },
            mergeMethod: pr.autoMergeRequest.mergeMethod,
          }
        : null,
  };
}

function mapRawPullRequestCore(pr: RawPullRequestCoreNode): GhPrListItemCore {
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    author: mapPullRequestAuthor(pr.author),
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
    reviewDecision: pr.reviewDecision ?? "",
    updatedAt: pr.updatedAt,
    url: pr.url,
    isDraft: pr.isDraft,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
  };
}

function mapRawPullRequestEnrichment(pr: RawPullRequestEnrichmentNode): GhPrEnrichment {
  return {
    number: pr.number,
    statusCheckRollup: mapStatusCheckRollup(pr.statusCheckRollup),
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    mergeable: pr.mergeable ?? "UNKNOWN",
    autoMergeRequest:
      pr.autoMergeRequest && pr.autoMergeRequest.enabledBy
        ? {
            enabledBy: { login: pr.autoMergeRequest.enabledBy.login },
            mergeMethod: pr.autoMergeRequest.mergeMethod,
          }
        : null,
  };
}

function toCorePrListItem({
  statusCheckRollup: _statusCheckRollup,
  mergeable: _mergeable,
  autoMergeRequest: _autoMergeRequest,
  ...core
}: GhPrListItem): GhPrListItemCore {
  return core;
}

function toPrEnrichment({
  number,
  statusCheckRollup,
  additions,
  deletions,
  mergeable,
  autoMergeRequest,
}: GhPrListItem): GhPrEnrichment {
  return {
    number,
    statusCheckRollup,
    additions,
    deletions,
    mergeable,
    autoMergeRequest,
  };
}

function buildPullRequestStateArgument(state: "open" | "closed" | "merged" | "all"): string {
  switch (state) {
    case "open": {
      return ", states: OPEN";
    }
    case "closed": {
      return ", states: CLOSED";
    }
    case "merged": {
      return ", states: MERGED";
    }
    case "all": {
      return "";
    }
  }
}

function buildUnlimitedPullRequestSearchQuery(
  repoFullName: string,
  filter: "reviewRequested" | "authored",
  state: "open" | "closed" | "merged" | "all",
): string {
  const searchTerms = [`repo:${repoFullName}`, "is:pr", "sort:updated-desc"];

  switch (state) {
    case "open": {
      searchTerms.push("is:open");
      break;
    }
    case "closed": {
      searchTerms.push("is:closed", "-is:merged");
      break;
    }
    case "merged": {
      searchTerms.push("is:merged");
      break;
    }
    case "all": {
      break;
    }
  }

  if (filter === "reviewRequested") {
    searchTerms.push("review-requested:@me");
  } else {
    searchTerms.push("author:@me");
  }

  return searchTerms.join(" ");
}

async function fetchUnlimitedRepositoryPullRequests(
  cwdOrTarget: string | RepoTarget,
  state: "open" | "closed" | "merged" | "all",
  fields = UNLIMITED_PULL_REQUEST_FIELDS,
): Promise<RawPullRequestNode[]> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const { owner, repo } = await getPullRequestRepo(cwdOrTarget);
  const stateArgument = buildPullRequestStateArgument(state);
  const query = `query($owner: String!, $repo: String!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequests(first: ${UNLIMITED_PR_PAGE_SIZE}, after: $after${stateArgument}, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
          ${fields}
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }`;

  const nodes: RawPullRequestNode[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const args = [
      "api",
      "graphql",
      "-f",
      `owner=${owner}`,
      "-f",
      `repo=${repo}`,
      "-f",
      `query=${query}`,
    ];

    if (after) {
      args.push("-f", `after=${after}`);
    }

    const { stdout } = await ghExec(args, { cwd: resolved.cwd, timeout: 60_000 });
    const data = parseJsonOutput<{
      data?: {
        repository?: {
          pullRequests?: {
            nodes: RawPullRequestNode[];
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          };
        };
      };
    }>(stdout);
    const connection = data.data?.repository?.pullRequests;

    nodes.push(...(connection?.nodes ?? []));
    hasNextPage = connection?.pageInfo.hasNextPage ?? false;
    after = connection?.pageInfo.endCursor ?? null;
  }

  return nodes;
}

async function fetchUnlimitedFilteredPullRequests(
  cwdOrTarget: string | RepoTarget,
  filter: "reviewRequested" | "authored",
  state: "open" | "closed" | "merged" | "all",
  fields = UNLIMITED_PULL_REQUEST_FIELDS,
): Promise<RawPullRequestNode[]> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const repoFullName = await getPullRequestRepoFullName(cwdOrTarget);
  const searchQuery = buildUnlimitedPullRequestSearchQuery(repoFullName, filter, state);
  const query = `query($searchQuery: String!, $after: String) {
    search(type: ISSUE, query: $searchQuery, first: ${UNLIMITED_PR_PAGE_SIZE}, after: $after) {
      nodes {
        ... on PullRequest {
          ${fields}
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }`;

  const nodes: RawPullRequestNode[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const args = ["api", "graphql", "-f", `searchQuery=${searchQuery}`, "-f", `query=${query}`];

    if (after) {
      args.push("-f", `after=${after}`);
    }

    const { stdout } = await ghExec(args, { cwd: resolved.cwd, timeout: 60_000 });
    const data = parseJsonOutput<{
      data?: {
        search?: {
          nodes: RawPullRequestNode[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      };
    }>(stdout);
    const connection = data.data?.search;

    nodes.push(...(connection?.nodes ?? []));
    hasNextPage = connection?.pageInfo.hasNextPage ?? false;
    after = connection?.pageInfo.endCursor ?? null;
  }

  return nodes;
}

function listUnlimitedPrs(
  cwdOrTarget: string | RepoTarget,
  filter: "reviewRequested" | "authored" | "all",
  state: "open" | "closed" | "merged" | "all",
  forceRefresh = false,
): Promise<GhPrListItem[]> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const key = cacheKey({ nwo: resolved.nwo, filter, state, limit: PR_FETCH_LIMIT_UNLIMITED });

  if (forceRefresh) {
    invalidateCacheKey(prFullCache, key);
  }

  return getOrLoadCached({
    cache: prFullCache,
    key,
    loader: async () => {
      const rawPullRequests =
        filter === "all"
          ? await fetchUnlimitedRepositoryPullRequests(cwdOrTarget, state)
          : await fetchUnlimitedFilteredPullRequests(cwdOrTarget, filter, state);
      const data = rawPullRequests.map((pr) => mapRawPullRequest(pr));

      cacheAuthorDisplayNames(data);
      setCache(prListCache, key, { data: data.map((pr) => toCorePrListItem(pr)) });
      setCache(prEnrichmentCache, key, { data: data.map((pr) => toPrEnrichment(pr)) });

      return data;
    },
  });
}

function resolvePrEnrichmentLimit(
  filter: "reviewRequested" | "authored" | "all",
  state: "open" | "closed" | "merged" | "all",
): string {
  const configuredLimit = Number.parseInt(resolvePrListLimit(), 10);

  if (!Number.isFinite(configuredLimit)) {
    return resolvePrListLimit();
  }

  if (state === "all") {
    return String(Math.min(configuredLimit, MAX_ALL_STATE_ENRICHMENT_LIMIT));
  }

  if (filter === "all") {
    return String(Math.min(configuredLimit, MAX_BROAD_ENRICHMENT_LIMIT));
  }

  return String(configuredLimit);
}

export function listPrsCore(
  cwdOrTarget: string | RepoTarget,
  filter: "reviewRequested" | "authored" | "all" = "reviewRequested",
  state: "open" | "closed" | "merged" | "all" = "open",
  forceRefresh = false,
): Promise<GhPrListItemCore[]> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const limit = resolvePrListLimit();
  const key = cacheKey({ nwo: resolved.nwo, filter, state, limit });
  if (forceRefresh) {
    invalidateCacheKey(prListCache, key);
  }
  return getOrLoadCached({
    cache: prListCache,
    key,
    loader: async () => {
      if (limit === PR_FETCH_LIMIT_UNLIMITED) {
        const rawPullRequests =
          filter === "all"
            ? await fetchUnlimitedRepositoryPullRequests(
                cwdOrTarget,
                state,
                UNLIMITED_PULL_REQUEST_CORE_FIELDS,
              )
            : await fetchUnlimitedFilteredPullRequests(
                cwdOrTarget,
                filter,
                state,
                UNLIMITED_PULL_REQUEST_CORE_FIELDS,
              );
        const data = rawPullRequests.map((pr) =>
          mapRawPullRequestCore(pr as RawPullRequestCoreNode),
        );
        cacheAuthorDisplayNames(data);
        return data;
      }

      const repoArgs =
        resolved.repoFlag.length > 0 ? resolved.repoFlag : await getUpstreamArgs(cwdOrTarget);
      const args = buildFilterArgs({
        filter,
        jsonFields: PR_LIST_CORE_FIELDS,
        repoArgs,
        state,
        limit,
      });
      const { stdout } = await ghExec(args, { cwd: resolved.cwd, timeout: 30_000 });
      const data = parseJsonOutput<GhPrListItemCore[]>(stdout);
      cacheAuthorDisplayNames(data);
      return data;
    },
  });
}

export function listPrsEnrichment(
  cwdOrTarget: string | RepoTarget,
  filter: "reviewRequested" | "authored" | "all" = "reviewRequested",
  state: "open" | "closed" | "merged" | "all" = "open",
  forceRefresh = false,
): Promise<GhPrEnrichment[]> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const configuredLimit = resolvePrListLimit();
  const limit =
    configuredLimit === PR_FETCH_LIMIT_UNLIMITED
      ? configuredLimit
      : resolvePrEnrichmentLimit(filter, state);
  const key = cacheKey({ nwo: resolved.nwo, filter, state, limit });
  if (forceRefresh) {
    invalidateCacheKey(prEnrichmentCache, key);
  }
  return getOrLoadCached({
    cache: prEnrichmentCache,
    key,
    loader: async () => {
      if (limit === PR_FETCH_LIMIT_UNLIMITED) {
        const rawPullRequests =
          filter === "all"
            ? await fetchUnlimitedRepositoryPullRequests(
                cwdOrTarget,
                state,
                UNLIMITED_PULL_REQUEST_ENRICHMENT_FIELDS,
              )
            : await fetchUnlimitedFilteredPullRequests(
                cwdOrTarget,
                filter,
                state,
                UNLIMITED_PULL_REQUEST_ENRICHMENT_FIELDS,
              );
        return rawPullRequests.map((pr) =>
          mapRawPullRequestEnrichment(pr as RawPullRequestEnrichmentNode),
        );
      }

      const repoArgs =
        resolved.repoFlag.length > 0 ? resolved.repoFlag : await getUpstreamArgs(cwdOrTarget);
      const args = buildFilterArgs({
        filter,
        jsonFields: PR_LIST_ENRICHMENT_FIELDS,
        repoArgs,
        state,
        limit,
      });
      const { stdout } = await ghExec(args, { cwd: resolved.cwd, timeout: 60_000 });
      return parseJsonOutput<GhPrEnrichment[]>(stdout);
    },
  });
}

export function listPrs(
  cwdOrTarget: string | RepoTarget,
  filter: "reviewRequested" | "authored" | "all" = "reviewRequested",
  state: "open" | "closed" | "merged" | "all" = "open",
): Promise<GhPrListItem[]> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const limit = resolvePrListLimit();

  if (limit === PR_FETCH_LIMIT_UNLIMITED) {
    return listUnlimitedPrs(cwdOrTarget, filter, state);
  }

  const key = cacheKey({ nwo: resolved.nwo, filter, state, limit });
  return getOrLoadCached({
    cache: prFullCache,
    key,
    loader: async () => {
      const repoArgs =
        resolved.repoFlag.length > 0 ? resolved.repoFlag : await getUpstreamArgs(cwdOrTarget);
      const args = buildFilterArgs({
        filter,
        jsonFields: PR_LIST_SLIM,
        repoArgs,
        state,
        limit,
      });
      const { stdout } = await ghExec(args, { cwd: resolved.cwd, timeout: 60_000 });
      const data = parseJsonOutput<GhPrListItem[]>(stdout);

      setCache(prListCache, key, {
        data: data.map((pr) => toCorePrListItem(pr)),
      });
      setCache(prEnrichmentCache, key, {
        data: data.map((pr) => toPrEnrichment(pr)),
      });

      return data;
    },
  });
}

const PR_DETAIL_FIELDS = [
  "number",
  "title",
  "state",
  "body",
  "author",
  "headRefName",
  "baseRefName",
  "headRefOid",
  "reviewDecision",
  "mergeable",
  "mergeStateStatus",
  "autoMergeRequest",
  "statusCheckRollup",
  "reviews",
  "files",
  "labels",
  "createdAt",
  "updatedAt",
  "closedAt",
  "mergedAt",
  "url",
  "isDraft",
  "additions",
  "changedFiles",
  "deletions",
].join(",");

export async function getPrDetail(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
): Promise<GhPrDetail> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const { stdout } = await ghExec(
    ["pr", "view", String(prNumber), "--json", PR_DETAIL_FIELDS, ...resolved.repoFlag],
    {
      cwd: resolved.cwd,
    },
  );
  const detail = parseJsonOutput<
    GhPrDetail & {
      changedFiles: number;
    }
  >(stdout);
  const { changedFiles, ...prDetail } = detail;

  if (changedFiles <= prDetail.files.length) {
    return prDetail;
  }

  try {
    const files = await listPullRequestFiles(cwdOrTarget, prNumber);
    return {
      ...prDetail,
      files: files.map((file) => ({
        path: file.filename,
        additions: file.additions,
        deletions: file.deletions,
      })),
    };
  } catch {
    return prDetail;
  }
}

export async function getPrDiff(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
): Promise<string> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  try {
    const { stdout } = await ghExec(["pr", "diff", String(prNumber), ...resolved.repoFlag], {
      cwd: resolved.cwd,
    });
    return stdout;
  } catch (error) {
    if (!shouldFallbackToPullRequestFilesApi(error)) {
      throw error;
    }

    const files = await listPullRequestFiles(cwdOrTarget, prNumber);
    return buildUnifiedDiffFromPullRequestFiles(files);
  }
}

export async function getFileAtRef(
  cwdOrTarget: string | RepoTarget,
  ref: string,
  filePath: string,
): Promise<string | null> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  try {
    const { owner, repo } = await getPullRequestRepo(cwdOrTarget);
    const { stdout } = await ghExec(
      [
        "api",
        `repos/${owner}/${repo}/contents/${filePath}?ref=${ref}`,
        "-H",
        "Accept: application/vnd.github.raw+json",
      ],
      { cwd: resolved.cwd, timeout: 15_000 },
    );
    return stdout;
  } catch {
    return null;
  }
}

interface PullRequestFileApiItem {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  previous_filename?: string;
}

const LARGE_PR_DIFF_ERROR_MARKERS = [
  "exceeded the maximum number of files",
  "list pull requests files",
];
const PULL_REQUEST_FILES_PAGE_SIZE = 100;
const PULL_REQUEST_FILES_CACHE_TTL_MS = 60_000;
const DIFF_NULL_PATH = "/dev/null";

function shouldFallbackToPullRequestFilesApi(error: unknown): boolean {
  const ghErrorText = [
    (error as Error | undefined)?.message,
    (error as { stderr?: string } | undefined)?.stderr,
    (error as { stdout?: string } | undefined)?.stdout,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n")
    .toLowerCase();

  return LARGE_PR_DIFF_ERROR_MARKERS.some((marker) => ghErrorText.includes(marker));
}

function listPullRequestFiles(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
): Promise<PullRequestFileApiItem[]> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const key = `prFiles::${resolved.nwo}::${prNumber}`;

  return getOrLoadCached({
    cache: genericCache,
    key,
    ttl: PULL_REQUEST_FILES_CACHE_TTL_MS,
    loader: async () => {
      const { owner, repo } = await getPullRequestRepo(cwdOrTarget);
      const files: PullRequestFileApiItem[] = [];

      for (let page = 1; ; page++) {
        const { stdout } = await ghExec(
          [
            "api",
            `repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=${PULL_REQUEST_FILES_PAGE_SIZE}&page=${page}`,
          ],
          { cwd: resolved.cwd, timeout: 30_000 },
        );
        const pageFiles = parseJsonOutput<PullRequestFileApiItem[]>(stdout);
        files.push(...pageFiles);

        if (pageFiles.length < PULL_REQUEST_FILES_PAGE_SIZE) {
          break;
        }
      }

      return files;
    },
  }) as Promise<PullRequestFileApiItem[]>;
}

function buildUnifiedDiffFromPullRequestFiles(
  files: ReadonlyArray<PullRequestFileApiItem>,
): string {
  return files
    .map((file) => buildUnifiedDiffSection(file))
    .filter((section): section is string => section !== null)
    .join("\n");
}

function buildUnifiedDiffSection(file: PullRequestFileApiItem): string | null {
  const headerOldPath =
    file.status === "renamed" ? (file.previous_filename ?? file.filename) : file.filename;
  const headerNewPath = file.filename;
  const oldMarker = file.status === "added" ? DIFF_NULL_PATH : `a/${headerOldPath}`;
  const newMarker = file.status === "removed" ? DIFF_NULL_PATH : `b/${headerNewPath}`;
  const lines = [`diff --git a/${headerOldPath} b/${headerNewPath}`];

  if (
    file.status === "renamed" &&
    file.previous_filename &&
    file.previous_filename !== file.filename
  ) {
    lines.push(`rename from ${file.previous_filename}`);
    lines.push(`rename to ${file.filename}`);
  }

  lines.push(`--- ${oldMarker}`);
  lines.push(`+++ ${newMarker}`);

  if (file.patch?.trim()) {
    lines.push(file.patch.trimEnd());
  }

  const section = lines.join("\n");
  return section.length > 0 ? section : null;
}

export async function getPrCommits(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
): Promise<Array<{ oid: string; message: string; author: string; committedDate: string }>> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const { stdout } = await ghExec(
    [
      "pr",
      "view",
      String(prNumber),
      "--json",
      "commits",
      "--jq",
      ".commits[] | {oid: .oid, message: .messageHeadline, author: .authors[0].login, committedDate: .committedDate}",
      ...resolved.repoFlag,
    ],
    { cwd: resolved.cwd, timeout: 15_000 },
  );
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function updatePrTitle(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
  title: string,
): Promise<void> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  await ghExec(["pr", "edit", String(prNumber), "--title", title, ...resolved.repoFlag], {
    cwd: resolved.cwd,
    timeout: 15_000,
  });
  invalidatePrListCaches(resolved.nwo);
}

export async function updatePrBody(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
  body: string,
): Promise<void> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  await ghExec(["pr", "edit", String(prNumber), "--body", body, ...resolved.repoFlag], {
    cwd: resolved.cwd,
    timeout: 15_000,
  });
  invalidatePrListCaches(resolved.nwo);
}

export async function listRepoLabels(
  cwdOrTarget: string | RepoTarget,
): Promise<Array<{ name: string; color: string; description: string }>> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const { stdout } = await ghExec(
    ["label", "list", "--json", "name,color,description", "--limit", "200", ...resolved.repoFlag],
    { cwd: resolved.cwd, timeout: 15_000 },
  );
  return parseJsonOutput<Array<{ name: string; color: string; description: string }>>(stdout);
}

export async function addPrLabel(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
  label: string,
): Promise<void> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  await ghExec(["pr", "edit", String(prNumber), "--add-label", label, ...resolved.repoFlag], {
    cwd: resolved.cwd,
    timeout: 15_000,
  });
}

export async function removePrLabel(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
  label: string,
): Promise<void> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  await ghExec(["pr", "edit", String(prNumber), "--remove-label", label, ...resolved.repoFlag], {
    cwd: resolved.cwd,
    timeout: 15_000,
  });
}

export type MergeStrategy = "merge" | "squash" | "rebase";

export async function mergePr(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
  strategy: MergeStrategy,
  admin = false,
  auto = false,
  hasMergeQueue = false,
): Promise<{ queued: boolean }> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const args = ["pr", "merge", String(prNumber), `--${strategy}`];
  if (!hasMergeQueue) {
    args.push("--delete-branch");
  }
  if (admin) {
    args.push("--admin");
  }
  if (auto) {
    args.push("--auto");
  }
  args.push(...resolved.repoFlag);
  const { stdout } = await ghExec(args, { cwd: resolved.cwd });
  invalidatePrListCaches(resolved.nwo);
  const queued = /merge queue|enqueue|auto-merge/i.test(stdout);
  return { queued };
}

export async function updatePrBranch(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
): Promise<void> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const repoFullName = await getPullRequestRepoFullName(cwdOrTarget);
  await ghExec(["api", `repos/${repoFullName}/pulls/${prNumber}/update-branch`, "-X", "PUT"], {
    cwd: resolved.cwd,
    timeout: 30_000,
  });
  invalidatePrListCaches(resolved.nwo);
}

export async function closePr(cwdOrTarget: string | RepoTarget, prNumber: number): Promise<void> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  await ghExec(["pr", "close", String(prNumber), ...resolved.repoFlag], { cwd: resolved.cwd });
  invalidatePrListCaches(resolved.nwo);
}

export async function getMergeQueueStatus(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
): Promise<{
  inQueue: boolean;
  position: number | null;
  state: string | null;
  estimatedTimeToMerge: number | null;
} | null> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  try {
    const { owner, repo } = await getPullRequestRepo(cwdOrTarget);
    const { stdout } = await ghExec(
      [
        "api",
        "graphql",
        "-f",
        `owner=${owner}`,
        "-f",
        `repo=${repo}`,
        "-f",
        `query=query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { pullRequest(number: ${prNumber}) { mergeQueueEntry { position state estimatedTimeToMerge } } } }`,
      ],
      { cwd: resolved.cwd, timeout: 10_000 },
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

export async function getPrReviewComments(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
): Promise<GhReviewComment[]> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const { owner, repo } = await getPullRequestRepo(cwdOrTarget);
  const { stdout } = await ghExec(
    ["api", `repos/${owner}/${repo}/pulls/${prNumber}/comments`, "--paginate"],
    { cwd: resolved.cwd, timeout: 30_000 },
  );
  return parseJsonOutput<GhReviewComment[]>(stdout);
}

export async function replyToReviewComment(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
  commentId: number,
  body: string,
): Promise<void> {
  const resolved = await resolveOpenPullRequest(cwdOrTarget, prNumber);
  const { owner, repo } = await getPullRequestRepo(cwdOrTarget);
  await ghExec(
    [
      "api",
      `repos/${owner}/${repo}/pulls/${prNumber}/comments`,
      "-X",
      "POST",
      "-f",
      `body=${body}`,
      "-F",
      `in_reply_to=${commentId}`,
    ],
    { cwd: resolved.cwd, timeout: 15_000 },
  );
  invalidatePrListCaches(resolved.nwo);
}

export async function createPrComment(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
  body: string,
): Promise<void> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  await ghExec(["pr", "comment", String(prNumber), "--body", body, ...resolved.repoFlag], {
    cwd: resolved.cwd,
    timeout: 15_000,
  });
  invalidatePrListCaches(resolved.nwo);
}

export async function getIssueComments(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
): Promise<Array<{ id: string; body: string; author: { login: string }; createdAt: string }>> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const { stdout } = await ghExec(
    [
      "pr",
      "view",
      String(prNumber),
      "--json",
      "comments",
      "--jq",
      ".comments",
      ...resolved.repoFlag,
    ],
    { cwd: resolved.cwd, timeout: 15_000 },
  );
  return parseJsonOutput<
    Array<{ id: string; body: string; author: { login: string }; createdAt: string }>
  >(stdout);
}

export async function getPrContributors(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
): Promise<string[]> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const { owner, repo } = await getPullRequestRepo(cwdOrTarget);
  const { stdout } = await ghExec(
    [
      "pr",
      "view",
      String(prNumber),
      "--json",
      "author,reviews,comments",
      "--jq",
      "[.author.login] + [.reviews[].author.login] + [.comments[].author.login] | unique | .[]",
      ...resolved.repoFlag,
    ],
    { cwd: resolved.cwd, timeout: 10_000 },
  );
  const logins = stdout.split("\n").filter(Boolean);

  try {
    const { stdout: contribOut } = await ghExec(
      ["api", `repos/${owner}/${repo}/contributors`, "--jq", ".[].login", "-q", "--paginate"],
      { cwd: resolved.cwd, timeout: 10_000 },
    );
    const repoContribs = contribOut.split("\n").filter(Boolean).slice(0, 30);
    const all = new Set([...logins, ...repoContribs]);
    return [...all].toSorted();
  } catch {
    return logins.toSorted();
  }
}

export async function searchUsers(
  cwdOrTarget: string | RepoTarget,
  query: string,
): Promise<Array<{ login: string; name: string | null }>> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  if (!query || query.length < 2) {
    return [];
  }
  try {
    const { stdout } = await ghExec(
      [
        "api",
        `search/users?q=${encodeURIComponent(query)}&per_page=8`,
        "--jq",
        ".items[] | {login: .login, name: .name}",
      ],
      { cwd: resolved.cwd, timeout: 8000 },
    );
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { login: string; name: string | null });
  } catch {
    return [];
  }
}

export function listIssuesAndPrs(
  cwdOrTarget: string | RepoTarget,
  limit = 50,
): Promise<Array<{ number: number; title: string; state: string; isPr: boolean }>> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const key = `issuesPrs::${resolved.nwo}::${limit}`;
  return getOrLoadCached({
    cache: genericCache,
    key,
    loader: async () => {
      const [issueResult, prResult] = await Promise.all([
        ghExec(
          [
            "issue",
            "list",
            "--json",
            "number,title,state",
            "--limit",
            String(limit),
            "--state",
            "all",
            ...resolved.repoFlag,
          ],
          { cwd: resolved.cwd, timeout: 15_000 },
        ),
        ghExec(
          [
            "pr",
            "list",
            "--json",
            "number,title,state",
            "--limit",
            String(limit),
            "--state",
            "all",
            ...resolved.repoFlag,
          ],
          { cwd: resolved.cwd, timeout: 15_000 },
        ),
      ]);

      const issues = parseJsonOutput<Array<{ number: number; title: string; state: string }>>(
        issueResult.stdout,
      );
      const prs = parseJsonOutput<Array<{ number: number; title: string; state: string }>>(
        prResult.stdout,
      );

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
    },
  }) as Promise<Array<{ number: number; title: string; state: string; isPr: boolean }>>;
}

export async function resolveReviewThread(
  cwdOrTarget: string | RepoTarget,
  threadId: string,
): Promise<void> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  await ghExec(
    [
      "api",
      "graphql",
      "-f",
      `query=mutation { resolveReviewThread(input: { threadId: "${threadId}" }) { thread { isResolved } } }`,
    ],
    { cwd: resolved.cwd, timeout: 10_000 },
  );
  invalidatePrListCaches(resolved.nwo);
}

export async function unresolveReviewThread(
  cwdOrTarget: string | RepoTarget,
  threadId: string,
): Promise<void> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  await ghExec(
    [
      "api",
      "graphql",
      "-f",
      `query=mutation { unresolveReviewThread(input: { threadId: "${threadId}" }) { thread { isResolved } } }`,
    ],
    { cwd: resolved.cwd, timeout: 10_000 },
  );
  invalidatePrListCaches(resolved.nwo);
}

export async function getPrReviewRequests(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
): Promise<
  Array<{
    login: string | null;
    name: string;
    type: "User" | "Team" | "Bot" | "Mannequin";
    asCodeOwner: boolean;
  }>
> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const { owner, repo } = await getPullRequestRepo(cwdOrTarget);
  const query = `query($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: ${prNumber}) {
        reviewRequests(first: 100) {
          nodes {
            asCodeOwner
            requestedReviewer {
              __typename
              ... on User { login name }
              ... on Team { name slug }
              ... on Bot { login }
              ... on Mannequin { login name }
            }
          }
        }
      }
    }
  }`;
  const { stdout } = await ghExec(
    ["api", "graphql", "-f", `owner=${owner}`, "-f", `repo=${repo}`, "-f", `query=${query}`],
    { cwd: resolved.cwd, timeout: 15_000 },
  );
  interface RawNode {
    asCodeOwner: boolean;
    requestedReviewer: {
      __typename: string;
      login?: string;
      name?: string;
      slug?: string;
    } | null;
  }
  const data = JSON.parse(stdout) as {
    data?: {
      repository?: {
        pullRequest?: {
          reviewRequests?: { nodes: RawNode[] };
        };
      };
    };
  };
  const nodes = data.data?.repository?.pullRequest?.reviewRequests?.nodes ?? [];
  return nodes
    .filter(
      (node): node is RawNode & { requestedReviewer: NonNullable<RawNode["requestedReviewer"]> } =>
        node.requestedReviewer !== null && node.requestedReviewer !== undefined,
    )
    .map((node) => {
      const reviewer = node.requestedReviewer;
      return {
        login: reviewer.login ?? null,
        name: reviewer.name ?? reviewer.slug ?? reviewer.login ?? "Unknown",
        type: reviewer.__typename as "User" | "Team" | "Bot" | "Mannequin",
        asCodeOwner: node.asCodeOwner,
      };
    });
}

export async function getPrReviewThreads(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
): Promise<
  Array<{
    id: string;
    isResolved: boolean;
    path: string;
    line: number | null;
    comments: Array<{ author: { login: string }; body: string }>;
  }>
> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const { owner, repo } = await getPullRequestRepo(cwdOrTarget);
  const query = `query($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: ${prNumber}) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            path
            line
            comments(first: 3) {
              nodes {
                author { login }
                body
              }
            }
          }
        }
      }
    }
  }`;
  const { stdout } = await ghExec(
    ["api", "graphql", "-f", `owner=${owner}`, "-f", `repo=${repo}`, "-f", `query=${query}`],
    { cwd: resolved.cwd, timeout: 15_000 },
  );
  const data = JSON.parse(stdout) as {
    data?: {
      repository?: {
        pullRequest?: {
          reviewThreads?: {
            nodes: Array<{
              id: string;
              isResolved: boolean;
              path: string;
              line: number | null;
              comments: { nodes: Array<{ author: { login: string }; body: string }> };
            }>;
          };
        };
      };
    };
  };
  const threads = data.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  return threads.map((thread) => ({
    id: thread.id,
    isResolved: thread.isResolved,
    path: thread.path,
    line: thread.line,
    comments: thread.comments.nodes,
  }));
}

export async function createReviewComment(args: {
  cwd: string | null;
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
  path: string;
  line: number;
  side?: "LEFT" | "RIGHT";
  startLine?: number;
  startSide?: "LEFT" | "RIGHT";
}): Promise<void> {
  const target: RepoTarget = { cwd: args.cwd, owner: args.owner, repo: args.repo };
  const resolved = await resolveOpenPullRequest(target, args.prNumber);
  const { stdout: commitSha } = await ghExec(
    [
      "pr",
      "view",
      String(args.prNumber),
      "--json",
      "headRefOid",
      "--jq",
      ".headRefOid",
      ...resolved.repoFlag,
    ],
    { cwd: resolved.cwd },
  );

  const { owner, repo } = await getPullRequestRepo(target);
  const side = args.side ?? "RIGHT";
  const ghArgs = [
    "api",
    `repos/${owner}/${repo}/pulls/${args.prNumber}/comments`,
    "-X",
    "POST",
    "-f",
    `body=${args.body}`,
    "-f",
    `path=${args.path}`,
    "-F",
    `line=${args.line}`,
    "-f",
    `side=${side}`,
    "-f",
    `commit_id=${commitSha.trim()}`,
  ];

  if (args.startLine && args.startLine !== args.line) {
    ghArgs.push("-F", `start_line=${args.startLine}`, "-f", `start_side=${args.startSide ?? side}`);
  }

  await ghExec(ghArgs, { cwd: resolved.cwd, timeout: 15_000 });
  invalidatePrListCaches(resolved.nwo);
}

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export async function submitReview(args: {
  cwd: string | null;
  owner: string;
  repo: string;
  prNumber: number;
  event: ReviewEvent;
  body?: string;
}): Promise<void> {
  const target: RepoTarget = { cwd: args.cwd, owner: args.owner, repo: args.repo };
  const resolved = await resolveOpenPullRequest(target, args.prNumber);
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
  ghArgs.push(...resolved.repoFlag);
  await ghExec(ghArgs, { cwd: resolved.cwd, timeout: 15_000 });
  invalidatePrListCaches(resolved.nwo);
}

const REACTION_GROUPS_FRAGMENT = `
  reactionGroups {
    content
    viewerHasReacted
    reactors(first: 0) { totalCount }
  }
`;

export async function getPrReactions(
  cwdOrTarget: string | RepoTarget,
  prNumber: number,
): Promise<GhPrReactions> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  const { owner, repo } = await getPullRequestRepo(cwdOrTarget);
  const query = `query($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: ${prNumber}) {
        id
        ${REACTION_GROUPS_FRAGMENT}
        comments(first: 100) {
          nodes {
            id
            databaseId
            ${REACTION_GROUPS_FRAGMENT}
          }
        }
        reviewThreads(first: 100) {
          nodes {
            comments(first: 100) {
              nodes {
                databaseId
                ${REACTION_GROUPS_FRAGMENT}
              }
            }
          }
        }
      }
    }
  }`;

  const { stdout } = await ghExec(
    ["api", "graphql", "-f", `owner=${owner}`, "-f", `repo=${repo}`, "-f", `query=${query}`],
    { cwd: resolved.cwd, timeout: 30_000 },
  );

  interface RawReactionGroup {
    content: string;
    viewerHasReacted: boolean;
    reactors: { totalCount: number };
  }
  interface RawIssueComment {
    id: string;
    databaseId: number;
    reactionGroups: RawReactionGroup[];
  }
  interface RawReviewComment {
    databaseId: number;
    reactionGroups: RawReactionGroup[];
  }

  const data = JSON.parse(stdout) as {
    data?: {
      repository?: {
        pullRequest?: {
          id: string;
          reactionGroups: RawReactionGroup[];
          comments: { nodes: RawIssueComment[] };
          reviewThreads: { nodes: Array<{ comments: { nodes: RawReviewComment[] } }> };
        };
      };
    };
  };

  const pr = data.data?.repository?.pullRequest;
  if (!pr) {
    return { prNodeId: "", prBody: [], issueComments: {}, reviewComments: {} };
  }

  function mapGroups(groups: RawReactionGroup[]): GhReactionGroup[] {
    return groups
      .filter((group) => group.reactors.totalCount > 0 || group.viewerHasReacted)
      .map((group) => ({
        content: group.content as GhReactionContent,
        count: group.reactors.totalCount,
        viewerHasReacted: group.viewerHasReacted,
      }));
  }

  const issueComments: Record<string, GhReactionGroup[]> = {};
  for (const comment of pr.comments.nodes) {
    issueComments[comment.id] = mapGroups(comment.reactionGroups);
  }

  const reviewComments: Record<string, GhReactionGroup[]> = {};
  for (const thread of pr.reviewThreads.nodes) {
    for (const comment of thread.comments.nodes) {
      const groups = mapGroups(comment.reactionGroups);
      if (groups.length > 0) {
        reviewComments[String(comment.databaseId)] = groups;
      }
    }
  }

  return {
    prNodeId: pr.id,
    prBody: mapGroups(pr.reactionGroups),
    issueComments,
    reviewComments,
  };
}

export async function addReaction(
  cwdOrTarget: string | RepoTarget,
  subjectId: string,
  content: GhReactionContent,
): Promise<void> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  await ghExec(
    [
      "api",
      "graphql",
      "-f",
      `query=mutation { addReaction(input: { subjectId: "${subjectId}", content: ${content} }) { reaction { content } } }`,
    ],
    { cwd: resolved.cwd, timeout: 10_000 },
  );
}

export async function removeReaction(
  cwdOrTarget: string | RepoTarget,
  subjectId: string,
  content: GhReactionContent,
): Promise<void> {
  const resolved =
    typeof cwdOrTarget === "string"
      ? { cwd: cwdOrTarget, repoFlag: [] as string[], nwo: cwdOrTarget }
      : resolveRepoCwd(cwdOrTarget);
  await ghExec(
    [
      "api",
      "graphql",
      "-f",
      `query=mutation { removeReaction(input: { subjectId: "${subjectId}", content: ${content} }) { reaction { content } } }`,
    ],
    { cwd: resolved.cwd, timeout: 10_000 },
  );
}
