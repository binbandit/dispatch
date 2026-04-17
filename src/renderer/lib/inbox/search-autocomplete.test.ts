import type { SearchablePrItem } from "@/renderer/lib/inbox/pr-search";

import { applySuggestion, getSearchSuggestions } from "@/renderer/lib/inbox/search-autocomplete";
import { describe, expect, it } from "vite-plus/test";

function createItem(
  overrides: Partial<Omit<SearchablePrItem, "pr">> & { pr?: Partial<SearchablePrItem["pr"]> } = {},
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
      workspace: "dispatch",
      workspacePath: "/repos/dispatch",
      repository: "acme/dispatch",
      pullRequestRepository: "acme/dispatch",
      ...prOverrides,
      isDraft: prOverrides?.isDraft ?? false,
    },
    hasNewActivity: overrides.hasNewActivity ?? false,
  };
}

describe("getSearchSuggestions", () => {
  const items = [
    createItem({
      pr: {
        number: 42,
        author: { login: "brayden", name: "Brayden Doyle" },
        reviewDecision: "CHANGES_REQUESTED",
      },
    }),
  ];

  it("suggests new structured fields and values", () => {
    expect(
      getSearchSuggestions("sta", 3, items).suggestions.map((suggestion) => suggestion.completion),
    ).toContain("state:");

    expect(
      getSearchSuggestions("review:c", 8, items).suggestions.map(
        (suggestion) => suggestion.completion,
      ),
    ).toContain("review:changes");
    expect(
      getSearchSuggestions("upd", 3, items).suggestions.map((suggestion) => suggestion.completion),
    ).toContain("updated:");
  });

  it("treats grouping characters as token boundaries", () => {
    expect(
      getSearchSuggestions("(rev", 4, items).suggestions.map((suggestion) => suggestion.completion),
    ).toContain("review:");
  });

  it("suggests aliases and operators when context is available", () => {
    expect(
      getSearchSuggestions("o", 1, items, {
        currentAuthorLogin: "brayden",
        currentRepoTerms: ["dispatch", "acme/dispatch"],
      }).suggestions.map((suggestion) => suggestion.completion),
    ).toContain("OR");
    expect(
      getSearchSuggestions("author:m", 8, items, {
        currentAuthorLogin: "brayden",
      }).suggestions.map((suggestion) => suggestion.completion),
    ).toContain("author:me");
    expect(
      getSearchSuggestions("repo:c", 6, items, {
        currentRepoTerms: ["dispatch"],
      }).suggestions.map((suggestion) => suggestion.completion),
    ).toContain("repo:current");
  });
});

describe("applySuggestion", () => {
  it("preserves negation prefixes when applying suggestions", () => {
    const { token } = getSearchSuggestions("-rev", 4, []);
    const result = applySuggestion("-rev", token, {
      completion: "review:",
      label: "review:",
      group: "field",
    });

    expect(result.query).toBe("-review:");
  });
});
