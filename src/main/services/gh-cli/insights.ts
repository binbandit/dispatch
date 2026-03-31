/* eslint-disable no-await-in-loop, no-continue, prefer-destructuring, init-declarations, @typescript-eslint/no-non-null-assertion -- Metrics, release, and multi-repo aggregation favor explicit data flow over helper indirection. */
import type { GhPrEnrichment, GhPrListItemCore } from "../../../shared/ipc";

import {
  CACHE_TTL_LONG_MS,
  MAX_CONCURRENT_GH_CALLS,
  genericCache,
  getOrLoadCached,
  getOwnerRepo,
  getRepoInfo,
  getUpstreamArgs,
  ghExec,
  invalidateReleaseCaches,
  mapWithConcurrency,
  parseJsonOutput,
} from "./core";
import { listPrsCore, listPrsEnrichment } from "./prs";

export async function listAllPrs(
  workspaces: Array<{ path: string; name: string }>,
  filter: "reviewRequested" | "authored" | "all",
  state: "open" | "closed" | "merged" | "all" = "open",
): Promise<
  Array<
    GhPrListItemCore & {
      workspace: string;
      workspacePath: string;
      repository: string;
      pullRequestRepository: string;
      isForkWorkspace: boolean;
    }
  >
> {
  const results = await mapWithConcurrency(
    workspaces,
    MAX_CONCURRENT_GH_CALLS,
    async (workspace) => {
      const workspaceRepo = await getRepoInfo(workspace.path).catch(async () => {
        const { owner, repo } = await getOwnerRepo(workspace.path);
        const nameWithOwner = `${owner}/${repo}`;
        return {
          nameWithOwner,
          isFork: false,
          parent: null,
          canPush: true,
          hasMergeQueue: false,
        };
      });
      const pullRequestRepository =
        workspaceRepo.isFork && workspaceRepo.parent
          ? workspaceRepo.parent
          : workspaceRepo.nameWithOwner;
      const prs = await listPrsCore(workspace.path, filter, state);
      return prs.map((pr) => ({
        ...pr,
        workspace: workspace.name,
        workspacePath: workspace.path,
        repository: workspaceRepo.nameWithOwner,
        pullRequestRepository,
        isForkWorkspace: workspaceRepo.isFork,
      }));
    },
  );

  return results
    .filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Array<
          GhPrListItemCore & {
            workspace: string;
            workspacePath: string;
            repository: string;
            pullRequestRepository: string;
            isForkWorkspace: boolean;
          }
        >
      > => result.status === "fulfilled",
    )
    .flatMap((result) => result.value);
}

export async function listAllPrsEnrichment(
  workspaces: Array<{ path: string; name: string }>,
  filter: "reviewRequested" | "authored" | "all",
  state: "open" | "closed" | "merged" | "all" = "open",
): Promise<
  Array<
    GhPrEnrichment & {
      workspacePath: string;
      repository: string;
      pullRequestRepository: string;
      isForkWorkspace: boolean;
    }
  >
> {
  const results = await mapWithConcurrency(
    workspaces,
    MAX_CONCURRENT_GH_CALLS,
    async (workspace) => {
      const workspaceRepo = await getRepoInfo(workspace.path).catch(async () => {
        const { owner, repo } = await getOwnerRepo(workspace.path);
        const nameWithOwner = `${owner}/${repo}`;
        return {
          nameWithOwner,
          isFork: false,
          parent: null,
          canPush: true,
          hasMergeQueue: false,
        };
      });
      const pullRequestRepository =
        workspaceRepo.isFork && workspaceRepo.parent
          ? workspaceRepo.parent
          : workspaceRepo.nameWithOwner;
      const enrichments = await listPrsEnrichment(workspace.path, filter, state);
      return enrichments.map((enrichment) => ({
        ...enrichment,
        workspacePath: workspace.path,
        repository: workspaceRepo.nameWithOwner,
        pullRequestRepository,
        isForkWorkspace: workspaceRepo.isFork,
      }));
    },
  );

  return results
    .filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Array<
          GhPrEnrichment & {
            workspacePath: string;
            repository: string;
            pullRequestRepository: string;
            isForkWorkspace: boolean;
          }
        >
      > => result.status === "fulfilled",
    )
    .flatMap((result) => result.value);
}

export function getPrCycleTime(
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
  const key = `cycleTime::${cwd}::${since}`;
  type CycleTimeResult = Array<{
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
  }>;
  return getOrLoadCached({
    cache: genericCache,
    key,
    loader: async () => {
      const { stdout } = await ghExec(
        [
          "pr",
          "list",
          "--state",
          "merged",
          "--json",
          "number,title,author,createdAt,mergedAt,additions,deletions,reviews",
          "--limit",
          "50",
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
            .map((review) => new Date(review.submittedAt))
            .toSorted((a, b) => a.getTime() - b.getTime())[0];

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
            timeToFirstReview: firstReviewMs
              ? Math.round((firstReviewMs - createdMs) / 60_000)
              : null,
            timeToMerge: mergedMs ? Math.round((mergedMs - createdMs) / 60_000) : null,
            additions: pr.additions,
            deletions: pr.deletions,
          };
        });
    },
    ttl: CACHE_TTL_LONG_MS,
  }) as Promise<CycleTimeResult>;
}

export function getReviewLoad(
  cwd: string,
  since: string,
): Promise<Array<{ reviewer: string; reviewCount: number; avgResponseTime: number }>> {
  const key = `reviewLoad::${cwd}::${since}`;
  type ReviewLoadResult = Array<{ reviewer: string; reviewCount: number; avgResponseTime: number }>;
  return getOrLoadCached({
    cache: genericCache,
    key,
    loader: async () => {
      const { stdout } = await ghExec(
        ["pr", "list", "--state", "all", "--json", "number,createdAt,reviews", "--limit", "50"],
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
        .toSorted((a, b) => b.reviewCount - a.reviewCount);
    },
    ttl: CACHE_TTL_LONG_MS,
  }) as Promise<ReviewLoadResult>;
}

export function listReleases(
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
  const key = `releases::${cwd}::${limit}`;
  type ReleaseResult = Array<{
    tagName: string;
    name: string;
    body: string;
    isDraft: boolean;
    isPrerelease: boolean;
    createdAt: string;
    author: { login: string };
  }>;
  return getOrLoadCached({
    cache: genericCache,
    key,
    loader: async () => {
      const upstreamArgs = await getUpstreamArgs(cwd);
      const { stdout } = await ghExec(
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

      const detailResults = await mapWithConcurrency(
        releases,
        MAX_CONCURRENT_GH_CALLS,
        async (release) => {
          const { stdout: detail } = await ghExec(
            [...upstreamArgs, "release", "view", release.tagName, "--json", "body,author"],
            { cwd, timeout: 10_000 },
          );
          const data = parseJsonOutput<{ body: string; author: { login: string } }>(detail);
          return { ...release, body: data.body ?? "", author: data.author ?? { login: "" } };
        },
      );

      return detailResults.map((result, index) =>
        result.status === "fulfilled"
          ? result.value
          : { ...releases[index]!, body: "", author: { login: "" } },
      );
    },
    ttl: CACHE_TTL_LONG_MS,
  }) as Promise<ReleaseResult>;
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
  const { stdout } = await ghExec(ghArgs, { cwd: args.cwd, timeout: 30_000 });
  invalidateReleaseCaches(args.cwd);
  return { url: stdout.trim() };
}

export async function generateChangelog(cwd: string, sinceTag: string): Promise<string> {
  const { stdout: tagDate } = await ghExec(
    ["release", "view", sinceTag, "--json", "createdAt", "--jq", ".createdAt"],
    { cwd, timeout: 10_000 },
  );

  const { stdout } = await ghExec(
    ["pr", "list", "--state", "merged", "--json", "number,title,author,mergedAt", "--limit", "50"],
    { cwd, timeout: 15_000 },
  );

  const prs =
    parseJsonOutput<
      Array<{ number: number; title: string; author: { login: string }; mergedAt: string }>
    >(stdout);

  const since = new Date(tagDate.trim());
  const relevantPrs = prs
    .filter((pr) => new Date(pr.mergedAt) > since)
    .toSorted((a, b) => new Date(a.mergedAt).getTime() - new Date(b.mergedAt).getTime());

  if (relevantPrs.length === 0) {
    return "No changes since last release.";
  }

  return relevantPrs.map((pr) => `- ${pr.title} (#${pr.number}) @${pr.author.login}`).join("\n");
}
