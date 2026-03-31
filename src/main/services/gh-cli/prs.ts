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
} from "../../../shared/ipc";

import {
  PR_LIST_ALL_FIELDS,
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
  resolvePrListLimit,
  setCache,
} from "./core";

export function listPrsCore(
  cwd: string,
  filter: "reviewRequested" | "authored" | "all" = "reviewRequested",
  state: "open" | "closed" | "merged" | "all" = "open",
  forceRefresh = false,
): Promise<GhPrListItemCore[]> {
  const limit = resolvePrListLimit();
  const key = cacheKey({ cwd, filter, state, limit });
  if (forceRefresh) {
    invalidateCacheKey(prListCache, key);
  }
  return getOrLoadCached({
    cache: prListCache,
    key,
    loader: async () => {
      const repoArgs = await getUpstreamArgs(cwd);
      const args = buildFilterArgs({
        filter,
        jsonFields: PR_LIST_CORE_FIELDS,
        repoArgs,
        state,
        limit,
      });
      const { stdout } = await ghExec(args, { cwd, timeout: 30_000 });
      const data = parseJsonOutput<GhPrListItemCore[]>(stdout);
      cacheAuthorDisplayNames(data);
      return data;
    },
  });
}

export function listPrsEnrichment(
  cwd: string,
  filter: "reviewRequested" | "authored" | "all" = "reviewRequested",
  state: "open" | "closed" | "merged" | "all" = "open",
  forceRefresh = false,
): Promise<GhPrEnrichment[]> {
  const limit = resolvePrListLimit();
  const key = cacheKey({ cwd, filter, state, limit });
  if (forceRefresh) {
    invalidateCacheKey(prEnrichmentCache, key);
  }
  return getOrLoadCached({
    cache: prEnrichmentCache,
    key,
    loader: async () => {
      const repoArgs = await getUpstreamArgs(cwd);
      const args = buildFilterArgs({
        filter,
        jsonFields: PR_LIST_ENRICHMENT_FIELDS,
        repoArgs,
        state,
        limit,
      });
      const { stdout } = await ghExec(args, { cwd, timeout: 60_000 });
      return parseJsonOutput<GhPrEnrichment[]>(stdout);
    },
  });
}

export function listPrs(
  cwd: string,
  filter: "reviewRequested" | "authored" | "all" = "reviewRequested",
  state: "open" | "closed" | "merged" | "all" = "open",
): Promise<GhPrListItem[]> {
  const limit = resolvePrListLimit();
  const key = cacheKey({ cwd, filter, state, limit });
  return getOrLoadCached({
    cache: prFullCache,
    key,
    loader: async () => {
      const repoArgs = await getUpstreamArgs(cwd);
      const args = buildFilterArgs({
        filter,
        jsonFields: PR_LIST_ALL_FIELDS,
        repoArgs,
        state,
        limit,
      });
      const { stdout } = await ghExec(args, { cwd, timeout: 60_000 });
      const data = parseJsonOutput<GhPrListItem[]>(stdout);

      setCache(prListCache, key, {
        data: data.map(
          ({
            statusCheckRollup: _,
            additions: _additions,
            deletions: _deletions,
            mergeable: _mergeable,
            autoMergeRequest: _autoMergeRequest,
            ...core
          }) => core,
        ),
      });
      setCache(prEnrichmentCache, key, {
        data: data.map(
          ({ number, statusCheckRollup, additions, deletions, mergeable, autoMergeRequest }) => ({
            number,
            statusCheckRollup,
            additions,
            deletions,
            mergeable,
            autoMergeRequest,
          }),
        ),
      });

      return data;
    },
  });
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
  "mergeStateStatus",
  "autoMergeRequest",
  "statusCheckRollup",
  "reviews",
  "files",
  "labels",
  "createdAt",
  "updatedAt",
  "url",
  "isDraft",
  "additions",
  "deletions",
].join(",");

export async function getPrDetail(cwd: string, prNumber: number): Promise<GhPrDetail> {
  const { stdout } = await ghExec(["pr", "view", String(prNumber), "--json", PR_DETAIL_FIELDS], {
    cwd,
  });
  return parseJsonOutput<GhPrDetail>(stdout);
}

export async function getPrDiff(cwd: string, prNumber: number): Promise<string> {
  const { stdout } = await ghExec(["pr", "diff", String(prNumber)], { cwd });
  return stdout;
}

export async function getFileAtRef(
  cwd: string,
  ref: string,
  filePath: string,
): Promise<string | null> {
  try {
    const { stdout } = await ghExec(
      [
        "api",
        `repos/{owner}/{repo}/contents/${filePath}?ref=${ref}`,
        "-H",
        "Accept: application/vnd.github.raw+json",
      ],
      { cwd, timeout: 15_000 },
    );
    return stdout;
  } catch {
    return null;
  }
}

export async function getPrCommits(
  cwd: string,
  prNumber: number,
): Promise<Array<{ oid: string; message: string; author: string; committedDate: string }>> {
  const { stdout } = await ghExec(
    [
      "pr",
      "view",
      String(prNumber),
      "--json",
      "commits",
      "--jq",
      ".commits[] | {oid: .oid, message: .messageHeadline, author: .authors[0].login, committedDate: .committedDate}",
    ],
    { cwd, timeout: 15_000 },
  );
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function updatePrTitle(cwd: string, prNumber: number, title: string): Promise<void> {
  await ghExec(["pr", "edit", String(prNumber), "--title", title], {
    cwd,
    timeout: 15_000,
  });
  invalidatePrListCaches(cwd);
}

export async function updatePrBody(cwd: string, prNumber: number, body: string): Promise<void> {
  await ghExec(["pr", "edit", String(prNumber), "--body", body], {
    cwd,
    timeout: 15_000,
  });
  invalidatePrListCaches(cwd);
}

export async function listRepoLabels(
  cwd: string,
): Promise<Array<{ name: string; color: string; description: string }>> {
  const { stdout } = await ghExec(
    ["label", "list", "--json", "name,color,description", "--limit", "200"],
    { cwd, timeout: 15_000 },
  );
  return parseJsonOutput<Array<{ name: string; color: string; description: string }>>(stdout);
}

export async function addPrLabel(cwd: string, prNumber: number, label: string): Promise<void> {
  await ghExec(["pr", "edit", String(prNumber), "--add-label", label], {
    cwd,
    timeout: 15_000,
  });
}

export async function removePrLabel(cwd: string, prNumber: number, label: string): Promise<void> {
  await ghExec(["pr", "edit", String(prNumber), "--remove-label", label], {
    cwd,
    timeout: 15_000,
  });
}

export type MergeStrategy = "merge" | "squash" | "rebase";

export async function mergePr(
  cwd: string,
  prNumber: number,
  strategy: MergeStrategy,
  admin = false,
  auto = false,
  hasMergeQueue = false,
): Promise<{ queued: boolean }> {
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
  const { stdout } = await ghExec(args, { cwd });
  invalidatePrListCaches(cwd);
  const queued = /merge queue|enqueue|auto-merge/i.test(stdout);
  return { queued };
}

export async function updatePrBranch(cwd: string, prNumber: number): Promise<void> {
  const repoFullName = await getPullRequestRepoFullName(cwd);
  await ghExec(["api", `repos/${repoFullName}/pulls/${prNumber}/update-branch`, "-X", "PUT"], {
    cwd,
    timeout: 30_000,
  });
  invalidatePrListCaches(cwd);
}

export async function closePr(cwd: string, prNumber: number): Promise<void> {
  await ghExec(["pr", "close", String(prNumber)], { cwd });
  invalidatePrListCaches(cwd);
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
    const { owner, repo } = await getPullRequestRepo(cwd);
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

export async function getPrReviewComments(
  cwd: string,
  prNumber: number,
): Promise<GhReviewComment[]> {
  const { stdout } = await ghExec(
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
  await ghExec(
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
  invalidatePrListCaches(cwd);
}

export async function createPrComment(cwd: string, prNumber: number, body: string): Promise<void> {
  await ghExec(["pr", "comment", String(prNumber), "--body", body], {
    cwd,
    timeout: 15_000,
  });
  invalidatePrListCaches(cwd);
}

export async function getIssueComments(
  cwd: string,
  prNumber: number,
): Promise<Array<{ id: string; body: string; author: { login: string }; createdAt: string }>> {
  const { stdout } = await ghExec(
    ["pr", "view", String(prNumber), "--json", "comments", "--jq", ".comments"],
    { cwd, timeout: 15_000 },
  );
  return parseJsonOutput<
    Array<{ id: string; body: string; author: { login: string }; createdAt: string }>
  >(stdout);
}

export async function getPrContributors(cwd: string, prNumber: number): Promise<string[]> {
  const { stdout } = await ghExec(
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

  try {
    const { stdout: contribOut } = await ghExec(
      ["api", "repos/{owner}/{repo}/contributors", "--jq", ".[].login", "-q", "--paginate"],
      { cwd, timeout: 10_000 },
    );
    const repoContribs = contribOut.split("\n").filter(Boolean).slice(0, 30);
    const all = new Set([...logins, ...repoContribs]);
    return [...all].toSorted();
  } catch {
    return logins.toSorted();
  }
}

export async function searchUsers(
  cwd: string,
  query: string,
): Promise<Array<{ login: string; name: string | null }>> {
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
      { cwd, timeout: 8000 },
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
  cwd: string,
  limit = 50,
): Promise<Array<{ number: number; title: string; state: string; isPr: boolean }>> {
  const key = `issuesPrs::${cwd}::${limit}`;
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
          ],
          { cwd, timeout: 15_000 },
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
          ],
          { cwd, timeout: 15_000 },
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

export async function resolveReviewThread(cwd: string, threadId: string): Promise<void> {
  await ghExec(
    [
      "api",
      "graphql",
      "-f",
      `query=mutation { resolveReviewThread(input: { threadId: "${threadId}" }) { thread { isResolved } } }`,
    ],
    { cwd, timeout: 10_000 },
  );
  invalidatePrListCaches(cwd);
}

export async function unresolveReviewThread(cwd: string, threadId: string): Promise<void> {
  await ghExec(
    [
      "api",
      "graphql",
      "-f",
      `query=mutation { unresolveReviewThread(input: { threadId: "${threadId}" }) { thread { isResolved } } }`,
    ],
    { cwd, timeout: 10_000 },
  );
  invalidatePrListCaches(cwd);
}

export async function getPrReviewRequests(
  cwd: string,
  prNumber: number,
): Promise<
  Array<{
    login: string | null;
    name: string;
    type: "User" | "Team" | "Bot" | "Mannequin";
    asCodeOwner: boolean;
  }>
> {
  const { owner, repo } = await getPullRequestRepo(cwd);
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
    { cwd, timeout: 15_000 },
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
  cwd: string,
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
  const { owner, repo } = await getPullRequestRepo(cwd);
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
    { cwd, timeout: 15_000 },
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
  cwd: string;
  prNumber: number;
  body: string;
  path: string;
  line: number;
}): Promise<void> {
  const { stdout: commitSha } = await ghExec(
    ["pr", "view", String(args.prNumber), "--json", "headRefOid", "--jq", ".headRefOid"],
    { cwd: args.cwd },
  );

  await ghExec(
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
  invalidatePrListCaches(args.cwd);
}

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
  await ghExec(ghArgs, { cwd: args.cwd, timeout: 15_000 });
  invalidatePrListCaches(args.cwd);
}

const REACTION_GROUPS_FRAGMENT = `
  reactionGroups {
    content
    viewerHasReacted
    reactors(first: 0) { totalCount }
  }
`;

export async function getPrReactions(cwd: string, prNumber: number): Promise<GhPrReactions> {
  const { owner, repo } = await getPullRequestRepo(cwd);
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
    { cwd, timeout: 30_000 },
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
  cwd: string,
  subjectId: string,
  content: GhReactionContent,
): Promise<void> {
  await ghExec(
    [
      "api",
      "graphql",
      "-f",
      `query=mutation { addReaction(input: { subjectId: "${subjectId}", content: ${content} }) { reaction { content } } }`,
    ],
    { cwd, timeout: 10_000 },
  );
}

export async function removeReaction(
  cwd: string,
  subjectId: string,
  content: GhReactionContent,
): Promise<void> {
  await ghExec(
    [
      "api",
      "graphql",
      "-f",
      `query=mutation { removeReaction(input: { subjectId: "${subjectId}", content: ${content} }) { reaction { content } } }`,
    ],
    { cwd, timeout: 10_000 },
  );
}
