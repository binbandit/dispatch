import {
  parsePrSearchQuery,
  searchPrs,
  stringifyPrSearchTokens,
  type SearchablePrItem,
} from "@/renderer/lib/inbox/pr-search";
import { describe, expect, it } from "vite-plus/test";

function createItem(
  overrides: Partial<Omit<SearchablePrItem, "pr">> & { pr?: Partial<SearchablePrItem["pr"]> },
): SearchablePrItem {
  const prOverrides = overrides.pr;

  return {
    pr: {
      number: 1,
      title: "Untitled pull request",
      state: "OPEN",
      author: { login: "octocat" },
      headRefName: "feature/example",
      baseRefName: "main",
      reviewDecision: "",
      updatedAt: "2026-03-20T00:00:00Z",
      url: "https://github.com/example/repo/pull/1",
      additions: 0,
      deletions: 0,
      ...prOverrides,
      isDraft: prOverrides?.isDraft ?? false,
    },
    hasNewActivity: overrides.hasNewActivity ?? false,
  };
}

describe("parsePrSearchQuery", () => {
  it("parses structured tokens, operators, grouping, negation, and incomplete filters", () => {
    expect(
      parsePrSearchQuery('@brayden OR (#42 review:changes) "search polish" -repo:api author:'),
    ).toEqual([
      {
        kind: "term",
        field: "author",
        negated: false,
        raw: "@brayden",
        value: "brayden",
      },
      {
        kind: "operator",
        operator: "or",
        raw: "OR",
      },
      {
        kind: "group",
        delimiter: "(",
        raw: "(",
      },
      {
        kind: "term",
        field: "number",
        negated: false,
        raw: "#42",
        value: "42",
      },
      {
        kind: "term",
        field: "review",
        negated: false,
        raw: "review:changes",
        value: "changes",
      },
      {
        kind: "group",
        delimiter: ")",
        raw: ")",
      },
      {
        kind: "term",
        field: "text",
        negated: false,
        raw: '"search polish"',
        value: "search polish",
      },
      {
        kind: "term",
        field: "repo",
        negated: true,
        raw: "-repo:api",
        value: "api",
      },
      {
        kind: "term",
        field: "author",
        negated: false,
        raw: "author:",
        value: "",
      },
    ]);
  });

  it("rebuilds token strings without losing quoted segments", () => {
    const tokens = parsePrSearchQuery('@brayden OR ("search polish" review:changes)');
    expect(stringifyPrSearchTokens(tokens)).toBe('@brayden OR ("search polish" review:changes)');
  });
});

describe("searchPrs", () => {
  const items: SearchablePrItem[] = [
    createItem({
      hasNewActivity: true,
      pr: {
        number: 42,
        title: "Refine pull request search",
        author: { login: "brayden", name: "Brayden Doyle" },
        headRefName: "feature/pr-search",
        baseRefName: "main",
        reviewDecision: "REVIEW_REQUIRED",
        updatedAt: "2026-03-20T10:00:00Z",
        url: "https://github.com/example/dispatch/pull/42",
        additions: 120,
        deletions: 30,
        workspace: "dispatch",
        workspacePath: "/repos/dispatch",
        repository: "acme/dispatch",
        pullRequestRepository: "acme/dispatch",
      },
    }),
    createItem({
      pr: {
        number: 9,
        title: "WIP sync onboarding copy",
        author: { login: "dependabot" },
        headRefName: "chore/onboarding-copy",
        baseRefName: "release/2026.03",
        reviewDecision: "",
        updatedAt: "2026-03-19T09:00:00Z",
        url: "https://github.com/example/marketing/pull/9",
        isDraft: true,
        additions: 18,
        deletions: 9,
        workspace: "marketing",
        workspacePath: "/repos/marketing",
        repository: "acme/marketing",
        pullRequestRepository: "acme/marketing",
      },
    }),
    createItem({
      pr: {
        number: 120,
        title: "Search cache cleanup",
        author: { login: "alexa" },
        headRefName: "release/search-cache",
        baseRefName: "main",
        reviewDecision: "APPROVED",
        updatedAt: "2026-03-20T12:00:00Z",
        url: "https://github.com/example/api/pull/120",
        additions: 410,
        deletions: 150,
        workspace: "api",
        workspacePath: "/repos/api",
        repository: "acme/api",
        pullRequestRepository: "acme/api",
      },
    }),
    createItem({
      pr: {
        number: 240,
        title: "Search",
        author: { login: "sam" },
        headRefName: "feature/search",
        baseRefName: "main",
        reviewDecision: "CHANGES_REQUESTED",
        updatedAt: "2026-03-18T08:00:00Z",
        url: "https://github.com/example/ops/pull/240",
        additions: 22,
        deletions: 6,
        workspace: "ops",
        workspacePath: "/repos/ops",
        repository: "acme/ops",
        pullRequestRepository: "acme/ops",
      },
    }),
    createItem({
      pr: {
        number: 301,
        title: "Retire search backlog",
        state: "MERGED",
        author: { login: "merle", name: "Merle Stone" },
        headRefName: "cleanup/search-backlog",
        baseRefName: "main",
        reviewDecision: "APPROVED",
        updatedAt: "2026-03-17T08:00:00Z",
        url: "https://github.com/example/dispatch/pull/301",
        additions: 66,
        deletions: 12,
        workspace: "dispatch",
        workspacePath: "/repos/dispatch",
        repository: "acme/dispatch",
        pullRequestRepository: "acme/dispatch",
      },
    }),
  ];

  it("matches free text across repo, branch, and semantic states", () => {
    expect(searchPrs(items, "dispatch").map(({ item }) => item.pr.number)).toEqual([42, 301]);
    expect(searchPrs(items, "acme/dispatch").map(({ item }) => item.pr.number)).toEqual([42, 301]);
    expect(searchPrs(items, "release/2026.03").map(({ item }) => item.pr.number)).toEqual([9]);
    expect(searchPrs(items, "draft").map(({ item }) => item.pr.number)).toEqual([9]);
    expect(searchPrs(items, "new").map(({ item }) => item.pr.number)).toEqual([42]);
  });

  it("supports structured filters, negation, size buckets, and review/state fields", () => {
    expect(
      searchPrs(items, "is:draft -author:brayden size:s").map(({ item }) => item.pr.number),
    ).toEqual([9]);

    expect(searchPrs(items, "size:xl -is:draft").map(({ item }) => item.pr.number)).toEqual([120]);
    expect(
      searchPrs(items, "state:merged review:approved repo:acme/dispatch").map(
        ({ item }) => item.pr.number,
      ),
    ).toEqual([301]);
  });

  it("matches author queries against logins and display names", () => {
    expect(searchPrs(items, "@brayden").map(({ item }) => item.pr.number)).toEqual([42]);
    expect(searchPrs(items, 'author:"Brayden Doyle"').map(({ item }) => item.pr.number)).toEqual([
      42,
    ]);
    expect(searchPrs(items, "doyle").map(({ item }) => item.pr.number)).toEqual([42]);
  });

  it("orders positive matches by relevance before recency", () => {
    expect(
      searchPrs(items, "search")
        .map(({ item }) => item.pr.number)
        .slice(0, 3),
    ).toEqual([240, 120, 42]);
  });

  it("returns empty for query with no matches", () => {
    expect(searchPrs(items, "zzzznonexistentzzzz")).toEqual([]);
  });

  it("returns all items for empty query", () => {
    expect(searchPrs(items, "").length).toBe(items.length);
  });

  it("matches PR number", () => {
    const result = searchPrs(items, "#42");
    expect(result.some(({ item }) => item.pr.number === 42)).toBe(true);
  });

  it("is case insensitive", () => {
    const upper = searchPrs(items, "SEARCH");
    const lower = searchPrs(items, "search");
    expect(upper.map(({ item }) => item.pr.number)).toEqual(
      lower.map(({ item }) => item.pr.number),
    );
  });

  it("supports compound OR groups with implicit AND", () => {
    expect(
      searchPrs(items, "search (review:changes OR state:merged)").map(({ item }) => item.pr.number),
    ).toEqual([240, 301]);
  });

  it("supports negated groups and preserves source order for negative-only queries", () => {
    expect(
      searchPrs(items, "-(state:merged OR review:changes)").map(({ item }) => item.pr.number),
    ).toEqual([42, 9, 120]);
  });
});
