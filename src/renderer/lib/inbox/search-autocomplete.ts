import type { SearchablePrItem } from "./pr-search";

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
  group: "field" | "value" | "author" | "branch" | "repo" | "number";
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
  { completion: "is:", label: "is:", hint: "draft, approved, new, review", group: "field" },
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
  { completion: "is:approved", label: "approved", hint: "approved PRs", group: "value" },
  { completion: "is:new", label: "new", hint: "PRs with new activity", group: "value" },
  { completion: "is:review", label: "review", hint: "review requested", group: "value" },
];

const SIZE_VALUES: SearchSuggestion[] = [
  { completion: "size:s", label: "s", hint: "< 50 lines", group: "value" },
  { completion: "size:m", label: "m", hint: "50–199 lines", group: "value" },
  { completion: "size:l", label: "l", hint: "200–499 lines", group: "value" },
  { completion: "size:xl", label: "xl", hint: "500+ lines", group: "value" },
];

// ---------------------------------------------------------------------------
// Token parsing
// ---------------------------------------------------------------------------

function findCurrentToken(query: string, cursor: number): CurrentToken | null {
  if (cursor === 0 && query.length === 0) {
    return null;
  }

  // Walk backward from cursor to find token start
  let start = cursor;
  while (start > 0 && query[start - 1] !== " ") {
    start--;
  }

  // Walk forward from cursor to find token end
  let end = cursor;
  while (end < query.length && query[end] !== " ") {
    end++;
  }

  const text = query.slice(start, end);
  if (!text) {
    return null;
  }

  // Check for field:value pattern
  const colonIdx = text.indexOf(":");
  if (colonIdx > 0) {
    return {
      start,
      end,
      text,
      field: text.slice(0, colonIdx).toLowerCase(),
      value: text.slice(colonIdx + 1).toLowerCase(),
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

  return results.toSorted((a, b) => a.label.localeCompare(b.label));
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

  return results.toSorted((a, b) => a.label.localeCompare(b.label));
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

  return results.toSorted((a, b) => a.label.localeCompare(b.label));
}

function extractNumbers(items: SearchablePrItem[]): SearchSuggestion[] {
  return items
    .map(({ pr }) => ({
      completion: `#${pr.number}`,
      label: `#${pr.number}`,
      hint: pr.title.length > 40 ? `${pr.title.slice(0, 40)}…` : pr.title,
      group: "number" as const,
    }))
    .toSorted((a, b) => b.completion.localeCompare(a.completion));
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

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
    .filter((s) => matchesFuzzy(s.label, filter) || matchesFuzzy(s.hint ?? "", filter))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

export function getSearchSuggestions(
  query: string,
  cursor: number,
  items: SearchablePrItem[],
): { suggestions: SearchSuggestion[]; token: CurrentToken | null } {
  const token = findCurrentToken(query, cursor);

  // Empty input or cursor at space boundary → show field hints
  if (!token) {
    return { suggestions: FIELD_SUGGESTIONS, token: null };
  }

  const text = token.text.toLowerCase();

  // Handle negation prefix — strip it for matching
  const isNegated = text.startsWith("-") || text.startsWith("!");
  const body = isNegated ? text.slice(1) : text;

  // Field:value completions
  if (token.field) {
    const value = token.value ?? "";

    switch (token.field) {
      case "is": {
        return {
          suggestions: filterSuggestions(IS_VALUES, value),
          token,
        };
      }
      case "size": {
        return {
          suggestions: filterSuggestions(SIZE_VALUES, value),
          token,
        };
      }
      case "author":
      case "by":
      case "user": {
        return {
          suggestions: filterSuggestions(extractAuthors(items), value),
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
          suggestions: filterSuggestions(extractRepos(items), value),
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
        // Partial field name — filter field suggestions
        return {
          suggestions: FIELD_SUGGESTIONS.filter((s) => s.completion.startsWith(body)),
          token,
        };
      }
    }
  }

  // @ shortcut → author list
  if (body.startsWith("@")) {
    const partial = body.slice(1);
    return {
      suggestions: filterSuggestions(extractAuthors(items), partial),
      token,
    };
  }

  // # shortcut → PR numbers
  if (body.startsWith("#")) {
    const partial = body.slice(1);
    return {
      suggestions: filterSuggestions(extractNumbers(items), partial),
      token,
    };
  }

  // Partial text that looks like start of a field prefix
  const matchingFields = FIELD_SUGGESTIONS.filter((s) => s.completion.startsWith(body));
  if (matchingFields.length > 0 && body.length > 0) {
    return { suggestions: matchingFields, token };
  }

  // No suggestions for plain text
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
    // Append to end
    const prefix = query.length > 0 && !query.endsWith(" ") ? " " : "";
    const newQuery = `${query}${prefix}${suggestion.completion}`;
    return { query: newQuery, cursor: newQuery.length };
  }

  // Check if we need to preserve negation prefix
  const negated = token.text.startsWith("-") || token.text.startsWith("!");
  const negPrefix = negated ? token.text[0] : "";

  const before = query.slice(0, token.start);
  const after = query.slice(token.end);

  // If completion ends with ":" (field prefix), don't add space
  const needsSpace =
    !suggestion.completion.endsWith(":") && after.length > 0 && !after.startsWith(" ");
  const space = needsSpace ? " " : "";

  const inserted = `${negPrefix}${suggestion.completion}${space}`;
  const newQuery = `${before}${inserted}${after}`;
  const cursor = before.length + inserted.length;

  return { query: newQuery, cursor };
}
