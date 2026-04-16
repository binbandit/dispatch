import type { PrSearchContext, SearchablePrItem } from "./pr-search";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchSuggestion {
  /** Text inserted into query when accepted */
  completion: string;
  /** Display label in dropdown */
  label: string;
  /** Optional description shown beside label */
  hint?: string;
  /** Category for grouping */
  group: "field" | "value" | "author" | "branch" | "repo" | "number" | "syntax";
}

interface CurrentToken {
  /** Start index of token in full query */
  start: number;
  /** End index of token in full query */
  end: number;
  /** Raw text of token */
  text: string;
  /** Field prefix if present (e.g. "is" from "is:draft") */
  field?: string;
  /** Value after colon (e.g. "draft" from "is:draft") */
  value?: string;
}

// ---------------------------------------------------------------------------
// Field definitions for suggestions
// ---------------------------------------------------------------------------

const FIELD_SUGGESTIONS: SearchSuggestion[] = [
  {
    completion: "is:",
    label: "is:",
    hint: "draft, mine, active, approved",
    group: "field",
  },
  { completion: "state:", label: "state:", hint: "open, closed, merged", group: "field" },
  {
    completion: "review:",
    label: "review:",
    hint: "approved, changes, review, none",
    group: "field",
  },
  { completion: "updated:", label: "updated:", hint: "7d, <24h, today", group: "field" },
  { completion: "age:", label: "age:", hint: ">30d, >7d", group: "field" },
  { completion: "size:", label: "size:", hint: "s, m, l, xl", group: "field" },
  { completion: "author:", label: "author:", hint: "login or name", group: "field" },
  { completion: "repo:", label: "repo:", hint: "repository name", group: "field" },
  { completion: "base:", label: "base:", hint: "target branch", group: "field" },
  { completion: "head:", label: "head:", hint: "source branch", group: "field" },
  { completion: "branch:", label: "branch:", hint: "any branch", group: "field" },
  { completion: "#", label: "#", hint: "PR number", group: "field" },
  { completion: "@", label: "@", hint: "author shortcut", group: "field" },
];

const IS_VALUES: SearchSuggestion[] = [
  { completion: "is:draft", label: "draft", hint: "draft PRs", group: "value" },
  { completion: "is:mine", label: "mine", hint: "authored by you", group: "value" },
  {
    completion: "is:active",
    label: "active",
    hint: "open and recently updated",
    group: "value",
  },
  { completion: "is:approved", label: "approved", hint: "approved PRs", group: "value" },
  { completion: "is:changes", label: "changes", hint: "changes requested", group: "value" },
  { completion: "is:new", label: "new", hint: "PRs with new activity", group: "value" },
  { completion: "is:review", label: "review", hint: "review requested", group: "value" },
  { completion: "is:open", label: "open", hint: "open PRs", group: "value" },
  { completion: "is:closed", label: "closed", hint: "closed PRs", group: "value" },
  { completion: "is:merged", label: "merged", hint: "merged PRs", group: "value" },
];

const REVIEW_VALUES: SearchSuggestion[] = [
  { completion: "review:approved", label: "approved", hint: "review approved", group: "value" },
  {
    completion: "review:changes",
    label: "changes",
    hint: "changes requested",
    group: "value",
  },
  { completion: "review:review", label: "review", hint: "review requested", group: "value" },
  { completion: "review:none", label: "none", hint: "no review decision", group: "value" },
];

const SIZE_VALUES: SearchSuggestion[] = [
  { completion: "size:s", label: "s", hint: "< 50 lines", group: "value" },
  { completion: "size:m", label: "m", hint: "50–199 lines", group: "value" },
  { completion: "size:l", label: "l", hint: "200–499 lines", group: "value" },
  { completion: "size:xl", label: "xl", hint: "500+ lines", group: "value" },
];

const STATE_VALUES: SearchSuggestion[] = [
  { completion: "state:open", label: "open", hint: "open PRs", group: "value" },
  { completion: "state:closed", label: "closed", hint: "closed PRs", group: "value" },
  { completion: "state:merged", label: "merged", hint: "merged PRs", group: "value" },
];

const UPDATED_VALUES: SearchSuggestion[] = [
  { completion: "updated:24h", label: "24h", hint: "updated in the last day", group: "value" },
  { completion: "updated:7d", label: "7d", hint: "updated in the last week", group: "value" },
  { completion: "updated:today", label: "today", hint: "updated today", group: "value" },
  { completion: "updated:<24h", label: "<24h", hint: "newer than a day", group: "value" },
];

const AGE_VALUES: SearchSuggestion[] = [
  { completion: "age:>24h", label: ">24h", hint: "older than a day", group: "value" },
  { completion: "age:>7d", label: ">7d", hint: "older than a week", group: "value" },
  { completion: "age:>30d", label: ">30d", hint: "older than a month", group: "value" },
];

const SYNTAX_SUGGESTIONS: SearchSuggestion[] = [
  { completion: "OR", label: "OR", hint: "either side can match", group: "syntax" },
  { completion: "(", label: "(", hint: "start a grouped clause", group: "syntax" },
  { completion: "!(", label: "!(", hint: "negate a grouped clause", group: "syntax" },
];

// ---------------------------------------------------------------------------
// Token parsing
// ---------------------------------------------------------------------------

function findCurrentToken(query: string, cursor: number): CurrentToken | null {
  if (cursor === 0 && query.length === 0) {
    return null;
  }

  let start = cursor;
  while (
    start > 0 &&
    query[start - 1] !== " " &&
    query[start - 1] !== "(" &&
    query[start - 1] !== ")" &&
    query[start - 1] !== "|" &&
    query[start - 1] !== "&"
  ) {
    start--;
  }

  let end = cursor;
  while (
    end < query.length &&
    query[end] !== " " &&
    query[end] !== "(" &&
    query[end] !== ")" &&
    query[end] !== "|" &&
    query[end] !== "&"
  ) {
    end++;
  }

  const text = query.slice(start, end);
  if (!text) {
    return null;
  }

  const colonIndex = text.indexOf(":");
  if (colonIndex > 0) {
    return {
      start,
      end,
      text,
      field: text.slice(0, colonIndex).toLowerCase(),
      value: text.slice(colonIndex + 1).toLowerCase(),
    };
  }

  return { start, end, text };
}

// ---------------------------------------------------------------------------
// Extract unique values from PR data
// ---------------------------------------------------------------------------

function extractAuthors(items: SearchablePrItem[]): SearchSuggestion[] {
  const seen = new Set<string>();
  const results: SearchSuggestion[] = [];

  for (const { pr } of items) {
    const { login } = pr.author;
    if (!seen.has(login)) {
      seen.add(login);
      results.push({
        completion: `@${login}`,
        label: login,
        hint: pr.author.name ?? undefined,
        group: "author",
      });
    }
  }

  return results.toSorted((left, right) => left.label.localeCompare(right.label));
}

function extractBranches(
  items: SearchablePrItem[],
  kind: "head" | "base" | "both",
): SearchSuggestion[] {
  const seen = new Set<string>();
  const results: SearchSuggestion[] = [];
  const prefix = kind === "both" ? "branch:" : `${kind}:`;

  for (const { pr } of items) {
    const branches =
      kind === "head"
        ? [pr.headRefName]
        : kind === "base"
          ? [pr.baseRefName]
          : [pr.headRefName, pr.baseRefName];

    for (const branch of branches) {
      if (!seen.has(branch)) {
        seen.add(branch);
        results.push({
          completion: `${prefix}${branch}`,
          label: branch,
          group: "branch",
        });
      }
    }
  }

  return results.toSorted((left, right) => left.label.localeCompare(right.label));
}

function extractRepos(items: SearchablePrItem[]): SearchSuggestion[] {
  const seen = new Set<string>();
  const results: SearchSuggestion[] = [];

  for (const { pr } of items) {
    const repo = pr.workspace ?? pr.workspacePath?.split("/").pop() ?? "";
    if (repo && !seen.has(repo)) {
      seen.add(repo);
      results.push({
        completion: `repo:${repo}`,
        label: repo,
        group: "repo",
      });
    }
  }

  return results.toSorted((left, right) => left.label.localeCompare(right.label));
}

function extractNumbers(items: SearchablePrItem[]): SearchSuggestion[] {
  return items
    .map(({ pr }) => ({
      completion: `#${pr.number}`,
      label: `#${pr.number}`,
      hint: pr.title.length > 40 ? `${pr.title.slice(0, 40)}…` : pr.title,
      group: "number" as const,
    }))
    .toSorted((left, right) => right.completion.localeCompare(left.completion));
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function matchesFuzzy(text: string, query: string): boolean {
  if (!query) {
    return true;
  }

  return text.toLowerCase().includes(query.toLowerCase());
}

function filterSuggestions(
  suggestions: SearchSuggestion[],
  filter: string,
  limit = 8,
): SearchSuggestion[] {
  return suggestions
    .filter((suggestion) => matchesFuzzy(suggestion.label, filter) || matchesFuzzy(suggestion.hint ?? "", filter))
    .slice(0, limit);
}

function withAliasSuggestions(
  suggestions: SearchSuggestion[],
  aliases: SearchSuggestion[],
): SearchSuggestion[] {
  const seen = new Set<string>();
  const merged: SearchSuggestion[] = [];

  for (const suggestion of [...aliases, ...suggestions]) {
    if (seen.has(suggestion.completion)) {
      continue;
    }

    seen.add(suggestion.completion);
    merged.push(suggestion);
  }

  return merged;
}

function getAuthorAliasSuggestions(context: PrSearchContext, shortcut = false): SearchSuggestion[] {
  const login = normalizeSearchValue(context.currentAuthorLogin ?? "");
  if (!login) {
    return [];
  }

  return [
    {
      completion: shortcut ? "@me" : "author:me",
      label: shortcut ? "@me" : "me",
      hint: login,
      group: "author",
    },
  ];
}

function getRepoAliasSuggestions(context: PrSearchContext): SearchSuggestion[] {
  const hasCurrentRepo = (context.currentRepoTerms ?? []).some((term) => term.trim().length > 0);
  if (!hasCurrentRepo) {
    return [];
  }

  return [
    {
      completion: "repo:current",
      label: "current",
      hint: "active workspace repository",
      group: "repo",
    },
  ];
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

export function getSearchSuggestions(
  query: string,
  cursor: number,
  items: SearchablePrItem[],
  context: PrSearchContext = {},
): { suggestions: SearchSuggestion[]; token: CurrentToken | null } {
  const token = findCurrentToken(query, cursor);

  if (!token) {
    return { suggestions: [...FIELD_SUGGESTIONS, ...SYNTAX_SUGGESTIONS], token: null };
  }

  const text = token.text.toLowerCase();
  const isNegated = text.startsWith("-") || text.startsWith("!");
  const body = isNegated ? text.slice(1) : text;

  if (token.field) {
    const value = token.value ?? "";

    switch (token.field) {
      case "is": {
        return {
          suggestions: filterSuggestions(IS_VALUES, value),
          token,
        };
      }
      case "review": {
        return {
          suggestions: filterSuggestions(REVIEW_VALUES, value),
          token,
        };
      }
      case "updated": {
        return {
          suggestions: filterSuggestions(UPDATED_VALUES, value),
          token,
        };
      }
      case "age": {
        return {
          suggestions: filterSuggestions(AGE_VALUES, value),
          token,
        };
      }
      case "size": {
        return {
          suggestions: filterSuggestions(SIZE_VALUES, value),
          token,
        };
      }
      case "state": {
        return {
          suggestions: filterSuggestions(STATE_VALUES, value),
          token,
        };
      }
      case "author":
      case "by":
      case "user": {
        return {
          suggestions: filterSuggestions(
            withAliasSuggestions(extractAuthors(items), getAuthorAliasSuggestions(context)),
            value,
          ),
          token,
        };
      }
      case "base": {
        return {
          suggestions: filterSuggestions(extractBranches(items, "base"), value),
          token,
        };
      }
      case "head": {
        return {
          suggestions: filterSuggestions(extractBranches(items, "head"), value),
          token,
        };
      }
      case "branch": {
        return {
          suggestions: filterSuggestions(extractBranches(items, "both"), value),
          token,
        };
      }
      case "repo":
      case "workspace": {
        return {
          suggestions: filterSuggestions(
            withAliasSuggestions(extractRepos(items), getRepoAliasSuggestions(context)),
            value,
          ),
          token,
        };
      }
      case "title":
      case "number":
      case "pr":
      case "id": {
        return { suggestions: [], token };
      }
      default: {
        const partialField = `${token.field}:`;
        return {
          suggestions: FIELD_SUGGESTIONS.filter((suggestion) =>
            suggestion.completion.startsWith(partialField),
          ),
          token,
        };
      }
    }
  }

  if (body.startsWith("@")) {
    const partial = body.slice(1);
    return {
      suggestions: filterSuggestions(
        withAliasSuggestions(extractAuthors(items), getAuthorAliasSuggestions(context, true)),
        partial,
      ),
      token,
    };
  }

  if (body.startsWith("#")) {
    const partial = body.slice(1);
    return {
      suggestions: filterSuggestions(extractNumbers(items), partial),
      token,
    };
  }

  const matchingFields = FIELD_SUGGESTIONS.filter((suggestion) =>
    suggestion.completion.startsWith(body),
  );
  const matchingSyntax = SYNTAX_SUGGESTIONS.filter((suggestion) =>
    suggestion.completion.toLowerCase().startsWith(body),
  );
  if ((matchingFields.length > 0 || matchingSyntax.length > 0) && body.length > 0) {
    return { suggestions: [...matchingFields, ...matchingSyntax], token };
  }

  return { suggestions: [], token };
}

/**
 * Apply a suggestion to the query string, replacing the current token.
 * Returns { query, cursor } with updated values.
 */
export function applySuggestion(
  query: string,
  token: CurrentToken | null,
  suggestion: SearchSuggestion,
): { query: string; cursor: number } {
  if (!token) {
    const prefix = query.length > 0 && !query.endsWith(" ") ? " " : "";
    const suffix =
      suggestion.completion.endsWith(":") || suggestion.completion.endsWith("(")
        ? ""
        : suggestion.group === "syntax" && suggestion.completion === "OR"
          ? " "
          : "";
    const newQuery = `${query}${prefix}${suggestion.completion}${suffix}`;
    return { query: newQuery, cursor: newQuery.length };
  }

  const negated = token.text.startsWith("-") || token.text.startsWith("!");
  const negPrefix = negated ? token.text[0] : "";

  const before = query.slice(0, token.start);
  const after = query.slice(token.end);

  const shouldStayAttached =
    suggestion.completion.endsWith(":") || suggestion.completion.endsWith("(");
  const shouldPadSyntax = suggestion.group === "syntax" && suggestion.completion === "OR";
  const space = shouldStayAttached
    ? ""
    : after.length > 0
      ? after.startsWith(" ")
        ? ""
        : " "
      : shouldPadSyntax
        ? " "
        : "";

  const inserted = `${negPrefix}${suggestion.completion}${space}`;
  const newQuery = `${before}${inserted}${after}`;
  const cursor = before.length + inserted.length;

  return { query: newQuery, cursor };
}
