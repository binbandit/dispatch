import type { GhPrListItemCore } from "@/shared/ipc";

export type PrSearchField =
  | "text"
  | "title"
  | "author"
  | "repo"
  | "branch"
  | "head"
  | "base"
  | "is"
  | "size"
  | "number";

export interface PrSearchToken {
  field: PrSearchField;
  negated: boolean;
  raw: string;
  value: string;
}

export interface SearchablePrItem {
  pr: GhPrListItemCore & { workspace?: string; workspacePath?: string };
  hasNewActivity?: boolean;
}

export interface PrSearchResult {
  item: SearchablePrItem;
  matchedFields: PrSearchField[];
  score: number;
}

type ReviewState = "approved" | "draft" | "new" | "review";
type PrSizeBucket = "l" | "m" | "s" | "xl";

const SEARCH_FIELD_ALIASES: Record<string, Exclude<PrSearchField, "text">> = {
  author: "author",
  base: "base",
  branch: "branch",
  by: "author",
  head: "head",
  id: "number",
  is: "is",
  number: "number",
  pr: "number",
  repo: "repo",
  size: "size",
  title: "title",
  user: "author",
  workspace: "repo",
};

const REVIEW_STATE_ALIASES: Record<ReviewState, string[]> = {
  approved: ["approved"],
  draft: ["draft", "wip"],
  new: ["new", "unseen", "updated"],
  review: ["needs-review", "review", "review-required"],
};

const SIZE_BUCKET_ALIASES: Record<PrSizeBucket, string[]> = {
  l: ["l", "large"],
  m: ["m", "medium"],
  s: ["s", "small"],
  xl: ["extra-large", "huge", "xl", "xlarge"],
};

interface QuerySegment {
  raw: string;
  value: string;
}

interface MatchResult {
  field: PrSearchField;
  matched: boolean;
  score: number;
}

interface SearchIndex {
  authorTerms: string[];
  base: string;
  branches: string[];
  head: string;
  number: string;
  repo: string;
  reviewStates: Set<ReviewState>;
  size: PrSizeBucket | null;
  title: string;
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function splitQuerySegments(query: string): QuerySegment[] {
  const segments: QuerySegment[] = [];
  let inQuotes = false;
  let raw = "";
  let value = "";

  const pushSegment = () => {
    const trimmedRaw = raw.trim();
    if (trimmedRaw) {
      segments.push({
        raw: trimmedRaw,
        value,
      });
    }
    raw = "";
    value = "";
  };

  for (const char of query) {
    if (!inQuotes && /\s/.test(char)) {
      pushSegment();
    } else {
      raw += char;

      if (char === '"') {
        inQuotes = !inQuotes;
      } else {
        value += char;
      }
    }
  }

  pushSegment();
  return segments;
}

function resolveRepoLabel(
  workspace: string | undefined,
  workspacePath: string | undefined,
): string {
  if (workspace) {
    return normalizeSearchValue(workspace);
  }

  if (!workspacePath) {
    return "";
  }

  const parts = workspacePath.split(/[/\\]/).filter(Boolean);
  return normalizeSearchValue(parts.at(-1) ?? "");
}

function resolveReviewStates(item: SearchablePrItem): Set<ReviewState> {
  const states = new Set<ReviewState>();

  if (item.pr.isDraft) {
    states.add("draft");
  }

  if (item.pr.reviewDecision === "APPROVED") {
    states.add("approved");
  }

  if (item.pr.reviewDecision === "REVIEW_REQUIRED") {
    states.add("review");
  }

  if (item.hasNewActivity) {
    states.add("new");
  }

  return states;
}

function resolveSizeBucket(pr: GhPrListItemCore): PrSizeBucket | null {
  const total = pr.additions + pr.deletions;
  if (total === 0) {
    return null;
  }

  if (total < 50) {
    return "s";
  }
  if (total < 200) {
    return "m";
  }
  if (total < 500) {
    return "l";
  }
  return "xl";
}

function createSearchIndex(item: SearchablePrItem): SearchIndex {
  return {
    authorTerms: [item.pr.author.login, item.pr.author.name ?? ""]
      .map(normalizeSearchValue)
      .filter(Boolean),
    base: normalizeSearchValue(item.pr.baseRefName),
    branches: [
      normalizeSearchValue(item.pr.headRefName),
      normalizeSearchValue(item.pr.baseRefName),
    ].filter(Boolean),
    head: normalizeSearchValue(item.pr.headRefName),
    number: String(item.pr.number),
    repo: resolveRepoLabel(item.pr.workspace, item.pr.workspacePath),
    reviewStates: resolveReviewStates(item),
    size: resolveSizeBucket(item.pr),
    title: normalizeSearchValue(item.pr.title),
  };
}

function scoreBestTextMatch(
  sources: string[],
  query: string,
  weights: { contains: number; exact: number; prefix: number; word: number },
): number {
  if (sources.length === 0) {
    return 0;
  }

  return Math.max(...sources.map((source) => scoreTextMatch(source, query, weights)));
}

function scoreTextMatch(
  source: string,
  query: string,
  weights: { contains: number; exact: number; prefix: number; word: number },
): number {
  if (!source || !query) {
    return 0;
  }

  if (source === query) {
    return weights.exact;
  }

  if (source.startsWith(query)) {
    return weights.prefix;
  }

  if (
    source.includes(` ${query}`) ||
    source.includes(`/${query}`) ||
    source.includes(`-${query}`) ||
    source.includes(`_${query}`)
  ) {
    return weights.word;
  }

  if (source.includes(query)) {
    return weights.contains;
  }

  return 0;
}

function resolveReviewAlias(value: string): ReviewState | null {
  for (const [state, aliases] of Object.entries(REVIEW_STATE_ALIASES)) {
    if (aliases.includes(value)) {
      return state as ReviewState;
    }
  }

  return null;
}

function resolveSizeAlias(value: string): PrSizeBucket | null {
  for (const [bucket, aliases] of Object.entries(SIZE_BUCKET_ALIASES)) {
    if (aliases.includes(value)) {
      return bucket as PrSizeBucket;
    }
  }

  return null;
}

function matchTextToken(index: SearchIndex, value: string): MatchResult {
  const candidates: MatchResult[] = [
    {
      field: "number",
      matched: false,
      score: scoreTextMatch(index.number, value, {
        contains: 104,
        exact: 128,
        prefix: 112,
        word: 112,
      }),
    },
    {
      field: "title",
      matched: false,
      score: scoreTextMatch(index.title, value, {
        contains: 44,
        exact: 80,
        prefix: 68,
        word: 56,
      }),
    },
    {
      field: "author",
      matched: false,
      score: scoreBestTextMatch(index.authorTerms, value, {
        contains: 36,
        exact: 72,
        prefix: 60,
        word: 48,
      }),
    },
    {
      field: "repo",
      matched: false,
      score: scoreTextMatch(index.repo, value, {
        contains: 34,
        exact: 64,
        prefix: 54,
        word: 42,
      }),
    },
    {
      field: "head",
      matched: false,
      score: scoreTextMatch(index.head, value, {
        contains: 28,
        exact: 52,
        prefix: 44,
        word: 36,
      }),
    },
    {
      field: "base",
      matched: false,
      score: scoreTextMatch(index.base, value, {
        contains: 24,
        exact: 48,
        prefix: 40,
        word: 32,
      }),
    },
  ];

  const reviewAlias = resolveReviewAlias(value);
  if (reviewAlias && index.reviewStates.has(reviewAlias)) {
    candidates.push({
      field: "is",
      matched: true,
      score: 60,
    });
  }

  const sizeAlias = resolveSizeAlias(value);
  if (sizeAlias && index.size === sizeAlias) {
    candidates.push({
      field: "size",
      matched: true,
      score: 48,
    });
  }

  let bestMatch: MatchResult = {
    field: "text",
    matched: false,
    score: 0,
  };

  for (const candidate of candidates) {
    if (candidate.score > bestMatch.score) {
      bestMatch = {
        field: candidate.field,
        matched: true,
        score: candidate.score,
      };
    }
  }

  return bestMatch;
}

function matchFieldToken(index: SearchIndex, token: PrSearchToken): MatchResult {
  switch (token.field) {
    case "text": {
      return matchTextToken(index, token.value);
    }
    case "number": {
      const score = scoreTextMatch(index.number, token.value, {
        contains: 88,
        exact: 128,
        prefix: 112,
        word: 112,
      });
      return { field: "number", matched: score > 0, score };
    }
    case "title": {
      const score = scoreTextMatch(index.title, token.value, {
        contains: 48,
        exact: 84,
        prefix: 70,
        word: 58,
      });
      return { field: "title", matched: score > 0, score };
    }
    case "author": {
      const score = scoreBestTextMatch(index.authorTerms, token.value, {
        contains: 42,
        exact: 76,
        prefix: 64,
        word: 52,
      });
      return { field: "author", matched: score > 0, score };
    }
    case "repo": {
      const score = scoreTextMatch(index.repo, token.value, {
        contains: 40,
        exact: 72,
        prefix: 60,
        word: 48,
      });
      return { field: "repo", matched: score > 0, score };
    }
    case "branch": {
      const score = scoreBestTextMatch(index.branches, token.value, {
        contains: 34,
        exact: 68,
        prefix: 56,
        word: 46,
      });
      return { field: "branch", matched: score > 0, score };
    }
    case "head": {
      const score = scoreTextMatch(index.head, token.value, {
        contains: 32,
        exact: 64,
        prefix: 54,
        word: 44,
      });
      return { field: "head", matched: score > 0, score };
    }
    case "base": {
      const score = scoreTextMatch(index.base, token.value, {
        contains: 28,
        exact: 60,
        prefix: 50,
        word: 40,
      });
      return { field: "base", matched: score > 0, score };
    }
    case "is": {
      const canonicalState = resolveReviewAlias(token.value);
      const score = canonicalState ? (index.reviewStates.has(canonicalState) ? 72 : 0) : 0;
      return { field: "is", matched: score > 0, score };
    }
    case "size": {
      const canonicalBucket = resolveSizeAlias(token.value);
      const score = canonicalBucket && index.size === canonicalBucket ? 64 : 0;
      return { field: "size", matched: score > 0, score };
    }
  }
}

export function parsePrSearchQuery(query: string): PrSearchToken[] {
  return splitQuerySegments(query)
    .map((segment) => {
      const value = segment.value.trim();
      if (!value) {
        return null;
      }

      const negated = value.startsWith("-") || value.startsWith("!");
      const body = negated ? value.slice(1) : value;
      if (!body) {
        return null;
      }

      if (body.startsWith("@")) {
        return {
          field: "author",
          negated,
          raw: segment.raw,
          value: normalizeSearchValue(body.slice(1)),
        } satisfies PrSearchToken;
      }

      if (body.startsWith("#")) {
        return {
          field: "number",
          negated,
          raw: segment.raw,
          value: normalizeSearchValue(body.slice(1)),
        } satisfies PrSearchToken;
      }

      const separatorIndex = body.indexOf(":");
      if (separatorIndex > 0) {
        const alias = SEARCH_FIELD_ALIASES[normalizeSearchValue(body.slice(0, separatorIndex))];
        if (alias) {
          return {
            field: alias,
            negated,
            raw: segment.raw,
            value: normalizeSearchValue(body.slice(separatorIndex + 1)),
          } satisfies PrSearchToken;
        }
      }

      return {
        field: "text",
        negated,
        raw: segment.raw,
        value: normalizeSearchValue(body),
      } satisfies PrSearchToken;
    })
    .filter((token): token is PrSearchToken => token !== null);
}

export function stringifyPrSearchTokens(tokens: PrSearchToken[]): string {
  return tokens
    .map((token) => token.raw)
    .join(" ")
    .trim();
}

export function searchPrs(items: SearchablePrItem[], query: string): PrSearchResult[] {
  const parsedTokens = parsePrSearchQuery(query);
  const tokens = parsedTokens.filter((token) => token.value.length > 0);

  if (tokens.length === 0) {
    return items.map((item) => ({
      item,
      matchedFields: [],
      score: 0,
    }));
  }

  const hasPositiveTokens = tokens.some((token) => !token.negated);

  const matches = items.flatMap((item, index) => {
    const searchIndex = createSearchIndex(item);
    const matchedFields = new Set<PrSearchField>();
    let score = 0;

    for (const token of tokens) {
      const match = matchFieldToken(searchIndex, token);

      if (token.negated) {
        if (match.matched) {
          return [];
        }
      } else if (match.matched) {
        matchedFields.add(match.field);
        score += match.score;
      } else {
        return [];
      }
    }

    return [
      {
        index,
        result: {
          item,
          matchedFields: [...matchedFields],
          score,
        },
      },
    ];
  });

  if (!hasPositiveTokens) {
    return matches.map(({ result }) => result);
  }

  return matches
    .toSorted((left, right) => {
      if (right.result.score !== left.result.score) {
        return right.result.score - left.result.score;
      }

      const rightUpdatedAt = Date.parse(right.result.item.pr.updatedAt);
      const leftUpdatedAt = Date.parse(left.result.item.pr.updatedAt);
      if (rightUpdatedAt !== leftUpdatedAt) {
        return rightUpdatedAt - leftUpdatedAt;
      }

      return left.index - right.index;
    })
    .map(({ result }) => result);
}
