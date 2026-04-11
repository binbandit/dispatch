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
  it("parses structured tokens, shortcuts, quotes, negation, and incomplete filters", () => {
    expect(
      parsePrSearchQuery('@brayden #42 status:failing "search polish" -repo:api author:'),
    ).toEqual([
      {
        field: "author",
        negated: false,
        raw: "@brayden",
        value: "brayden",
      },
      {
        field: "number",
        negated: false,
        raw: "#42",
        value: "42",
      },
      {
        field: "text",
        negated: false,
        raw: "status:failing",
        value: "status:failing",
      },
      {
        field: "text",
        negated: false,
        raw: '"search polish"',
        value: "search polish",
      },
      {
        field: "repo",
        negated: true,
        raw: "-repo:api",
        value: "api",
      },
      {
        field: "author",
        negated: false,
        raw: "author:",
        value: "",
      },
    ]);
  });

  it("rebuilds token strings without losing quoted segments", () => {
    const tokens = parsePrSearchQuery('@brayden "search polish" status:pending');
    expect(stringifyPrSearchTokens(tokens)).toBe('@brayden "search polish" status:pending');
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
      },
    }),
    createItem({
      pr: {
        number: 240,
        title: "Search",
        author: { login: "sam" },
        headRefName: "feature/search",
        baseRefName: "main",
        reviewDecision: "",
        updatedAt: "2026-03-18T08:00:00Z",
        url: "https://github.com/example/ops/pull/240",
        additions: 22,
        deletions: 6,
        workspace: "ops",
        workspacePath: "/repos/ops",
      },
    }),
  ];

  it("matches free text across repo, branch, and semantic states", () => {
    expect(searchPrs(items, "dispatch").map(({ item }) => item.pr.number)).toEqual([42]);
    expect(searchPrs(items, "release/2026.03").map(({ item }) => item.pr.number)).toEqual([9]);
    expect(searchPrs(items, "draft").map(({ item }) => item.pr.number)).toEqual([9]);
    expect(searchPrs(items, "new").map(({ item }) => item.pr.number)).toEqual([42]);
  });

  it("supports structured filters, negation, and size buckets", () => {
    expect(
      searchPrs(items, "is:draft -author:brayden size:s").map(({ item }) => item.pr.number),
    ).toEqual([9]);

    expect(searchPrs(items, "size:xl -is:draft").map(({ item }) => item.pr.number)).toEqual([120]);
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
});
