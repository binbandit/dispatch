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
  | "state"
  | "review"
  | "size"
  | "number";

export interface PrSearchTermToken {
  kind: "term";
  field: PrSearchField;
  negated: boolean;
  raw: string;
  value: string;
}

export interface PrSearchOperatorToken {
  kind: "operator";
  operator: "and" | "or" | "not";
  raw: string;
}

export interface PrSearchGroupToken {
  kind: "group";
  delimiter: "(" | ")";
  raw: string;
}

export type PrSearchToken = PrSearchTermToken | PrSearchOperatorToken | PrSearchGroupToken;

export interface SearchablePrItem {
  pr: GhPrListItemCore & {
    workspace?: string;
    workspacePath?: string;
    repository?: string;
    pullRequestRepository?: string;
  };
  hasNewActivity?: boolean;
}

export interface PrSearchResult {
  item: SearchablePrItem;
  matchedFields: PrSearchField[];
  score: number;
}

type SearchFlag =
  | "approved"
  | "changes"
  | "closed"
  | "draft"
  | "merged"
  | "new"
  | "open"
  | "review";
type PrReviewBucket = "approved" | "changes" | "none" | "review";
type PrSizeBucket = "l" | "m" | "s" | "xl";
type PrStateBucket = "closed" | "merged" | "open";

type SearchExpression =
  | { kind: "and"; left: SearchExpression; right: SearchExpression }
  | { kind: "not"; child: SearchExpression }
  | { kind: "or"; left: SearchExpression; right: SearchExpression }
  | { kind: "term"; term: PrSearchTermToken };

interface MatchResult {
  field: PrSearchField;
  matched: boolean;
  score: number;
}

interface SearchExpressionResult {
  fields: Set<PrSearchField>;
  matched: boolean;
  score: number;
}

interface SearchIndex {
  authorTerms: string[];
  base: string;
  branches: string[];
  flags: Set<SearchFlag>;
  head: string;
  number: string;
  repoTerms: string[];
  review: PrReviewBucket;
  size: PrSizeBucket | null;
  state: PrStateBucket;
  title: string;
}

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
  review: "review",
  size: "size",
  state: "state",
  title: "title",
  user: "author",
  workspace: "repo",
};

const SEARCH_FLAG_ALIASES: Record<SearchFlag, string[]> = {
  approved: ["approved"],
  changes: ["blocked", "changes", "changes-requested", "requested-changes"],
  closed: ["closed"],
  draft: ["draft", "wip"],
  merged: ["merged"],
  new: ["new", "unseen", "updated"],
  open: ["open"],
  review: ["needs-review", "review", "review-required", "review-requested"],
};

const REVIEW_BUCKET_ALIASES: Record<PrReviewBucket, string[]> = {
  approved: ["approved"],
  changes: ["blocked", "changes", "changes-requested", "requested-changes"],
  none: ["none", "unreviewed"],
  review: ["needs-review", "requested", "review", "review-required", "review-requested"],
};

const SIZE_BUCKET_ALIASES: Record<PrSizeBucket, string[]> = {
  l: ["l", "large"],
  m: ["m", "medium"],
  s: ["s", "small"],
  xl: ["extra-large", "huge", "xl", "xlarge"],
};

const STATE_BUCKET_ALIASES: Record<PrStateBucket, string[]> = {
  closed: ["closed"],
  merged: ["merged"],
  open: ["open"],
};

function isOperatorToken(
  token: PrSearchToken | undefined,
  operator: "and" | "or" | "not",
): boolean {
  return token?.kind === "operator" && token.operator === operator;
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeTokenValue(value: string): string {
  return normalizeSearchValue(value.replaceAll('"', ""));
}

function lexQueryParts(query: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) {
      parts.push(trimmed);
    }
    current = "";
  };

  for (let index = 0; index < query.length; index += 1) {
    const char = query[index]!;
    const nextChar = query[index + 1] ?? "";

    if (char === '"') {
      current += char;
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && /\s/.test(char)) {
      pushCurrent();
      continue;
    }

    if (!inQuotes && (char === "(" || char === ")" || char === "|" || char === "&")) {
      pushCurrent();
      parts.push(char);
      continue;
    }

    if (
      !inQuotes &&
      current.length === 0 &&
      (char === "!" || char === "-") &&
      (nextChar === "(" || nextChar === "" || /\s/.test(nextChar))
    ) {
      pushCurrent();
      parts.push(char);
      continue;
    }

    current += char;
  }

  pushCurrent();
  return parts;
}

function resolveFlagAlias(value: string): SearchFlag | null {
  for (const [flag, aliases] of Object.entries(SEARCH_FLAG_ALIASES)) {
    if (aliases.includes(value)) {
      return flag as SearchFlag;
    }
  }

  return null;
}

function resolveReviewBucketAlias(value: string): PrReviewBucket | null {
  for (const [bucket, aliases] of Object.entries(REVIEW_BUCKET_ALIASES)) {
    if (aliases.includes(value)) {
      return bucket as PrReviewBucket;
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

function resolveStateAlias(value: string): PrStateBucket | null {
  for (const [bucket, aliases] of Object.entries(STATE_BUCKET_ALIASES)) {
    if (aliases.includes(value)) {
      return bucket as PrStateBucket;
    }
  }

  return null;
}

function parseSearchTerm(raw: string): PrSearchTermToken {
  const negated = raw.startsWith("-") || raw.startsWith("!");
  const body = negated ? raw.slice(1) : raw;

  if (body.startsWith("@")) {
    return {
      kind: "term",
      field: "author",
      negated,
      raw,
      value: normalizeTokenValue(body.slice(1)),
    };
  }

  if (body.startsWith("#")) {
    return {
      kind: "term",
      field: "number",
      negated,
      raw,
      value: normalizeTokenValue(body.slice(1)),
    };
  }

  const separatorIndex = body.indexOf(":");
  if (separatorIndex > 0) {
    const alias = SEARCH_FIELD_ALIASES[normalizeSearchValue(body.slice(0, separatorIndex))];
    if (alias) {
      return {
        kind: "term",
        field: alias,
        negated,
        raw,
        value: normalizeTokenValue(body.slice(separatorIndex + 1)),
      };
    }
  }

  return {
    kind: "term",
    field: "text",
    negated,
    raw,
    value: normalizeTokenValue(body),
  };
}

function parseSearchToken(raw: string): PrSearchToken {
  const normalized = normalizeSearchValue(raw);

  if (raw === "(" || raw === ")") {
    return {
      kind: "group",
      delimiter: raw,
      raw,
    };
  }

  if (raw === "|" || normalized === "or") {
    return {
      kind: "operator",
      operator: "or",
      raw,
    };
  }

  if (raw === "&" || normalized === "and") {
    return {
      kind: "operator",
      operator: "and",
      raw,
    };
  }

  if (raw === "!" || raw === "-" || normalized === "not") {
    return {
      kind: "operator",
      operator: "not",
      raw,
    };
  }

  return parseSearchTerm(raw);
}

function stringifySearchToken(token: PrSearchToken): string {
  return token.raw;
}

function resolveRepoPathTerm(workspacePath: string | undefined): string {
  if (!workspacePath) {
    return "";
  }

  const parts = workspacePath.split(/[/\\]/).filter(Boolean);
  return normalizeSearchValue(parts.at(-1) ?? "");
}

function resolveRepoTerms(pr: SearchablePrItem["pr"]): string[] {
  return [
    ...new Set(
      [pr.workspace, resolveRepoPathTerm(pr.workspacePath), pr.repository, pr.pullRequestRepository]
        .map((term) => normalizeSearchValue(term ?? ""))
        .filter(Boolean),
    ),
  ];
}

function resolveReviewBucket(item: SearchablePrItem): PrReviewBucket {
  if (item.pr.reviewDecision === "APPROVED") {
    return "approved";
  }

  if (item.pr.reviewDecision === "CHANGES_REQUESTED") {
    return "changes";
  }

  if (item.pr.reviewDecision === "REVIEW_REQUIRED") {
    return "review";
  }

  return "none";
}

function resolveSearchFlags(item: SearchablePrItem): Set<SearchFlag> {
  const flags = new Set<SearchFlag>();

  if (item.pr.isDraft) {
    flags.add("draft");
  }

  if (item.pr.reviewDecision === "APPROVED") {
    flags.add("approved");
  }

  if (item.pr.reviewDecision === "CHANGES_REQUESTED") {
    flags.add("changes");
  }

  if (item.pr.reviewDecision === "REVIEW_REQUIRED") {
    flags.add("review");
  }

  if (item.pr.state === "OPEN") {
    flags.add("open");
  }

  if (item.pr.state === "CLOSED") {
    flags.add("closed");
  }

  if (item.pr.state === "MERGED") {
    flags.add("merged");
  }

  if (item.hasNewActivity) {
    flags.add("new");
  }

  return flags;
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
      .map((term) => normalizeSearchValue(term))
      .filter(Boolean),
    base: normalizeSearchValue(item.pr.baseRefName),
    branches: [
      normalizeSearchValue(item.pr.headRefName),
      normalizeSearchValue(item.pr.baseRefName),
    ].filter(Boolean),
    flags: resolveSearchFlags(item),
    head: normalizeSearchValue(item.pr.headRefName),
    number: String(item.pr.number),
    repoTerms: resolveRepoTerms(item.pr),
    review: resolveReviewBucket(item),
    size: resolveSizeBucket(item.pr),
    state: normalizeSearchValue(item.pr.state) as PrStateBucket,
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
      score: scoreBestTextMatch(index.repoTerms, value, {
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

  const flagAlias = resolveFlagAlias(value);
  if (flagAlias && index.flags.has(flagAlias)) {
    candidates.push({
      field: "is",
      matched: true,
      score: 60,
    });
  }

  const reviewAlias = resolveReviewBucketAlias(value);
  if (reviewAlias && index.review === reviewAlias) {
    candidates.push({
      field: "review",
      matched: true,
      score: 58,
    });
  }

  const stateAlias = resolveStateAlias(value);
  if (stateAlias && index.state === stateAlias) {
    candidates.push({
      field: "state",
      matched: true,
      score: 56,
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

function matchFieldToken(index: SearchIndex, token: PrSearchTermToken): MatchResult {
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
      const score = scoreBestTextMatch(index.repoTerms, token.value, {
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
      const canonicalFlag = resolveFlagAlias(token.value);
      const score = canonicalFlag && index.flags.has(canonicalFlag) ? 72 : 0;
      return { field: "is", matched: score > 0, score };
    }
    case "state": {
      const canonicalState = resolveStateAlias(token.value);
      const score = canonicalState && index.state === canonicalState ? 72 : 0;
      return { field: "state", matched: score > 0, score };
    }
    case "review": {
      const canonicalReview = resolveReviewBucketAlias(token.value);
      const score = canonicalReview && index.review === canonicalReview ? 72 : 0;
      return { field: "review", matched: score > 0, score };
    }
    case "size": {
      const canonicalBucket = resolveSizeAlias(token.value);
      const score = canonicalBucket && index.size === canonicalBucket ? 64 : 0;
      return { field: "size", matched: score > 0, score };
    }
  }
}

function buildSearchExpression(tokens: PrSearchToken[]): SearchExpression | null {
  let index = 0;

  const current = (): PrSearchToken | undefined => tokens[index];

  const advance = (): PrSearchToken | undefined => {
    const token = tokens[index];
    index += 1;
    return token;
  };

  const parsePrimary = (): SearchExpression | null => {
    const token = current();
    if (!token) {
      return null;
    }

    if (token.kind === "group") {
      if (token.delimiter === ")") {
        return null;
      }

      advance();
      const inner = parseOr();
      if (current()?.kind === "group" && current()?.delimiter === ")") {
        advance();
      }
      return inner;
    }

    if (token.kind === "operator") {
      advance();
      return null;
    }

    advance();

    if (token.value.length === 0) {
      return null;
    }

    const normalizedTerm = token.negated ? { ...token, negated: false } : token;
    const termExpression: SearchExpression = {
      kind: "term",
      term: normalizedTerm,
    };

    return token.negated
      ? {
          kind: "not",
          child: termExpression,
        }
      : termExpression;
  };

  const parseUnary = (): SearchExpression | null => {
    let negateCount = 0;

    while (isOperatorToken(current(), "not")) {
      advance();
      negateCount += 1;
    }

    const expression = parsePrimary();
    if (!expression) {
      return null;
    }

    return negateCount % 2 === 1
      ? {
          kind: "not",
          child: expression,
        }
      : expression;
  };

  const parseAnd = (): SearchExpression | null => {
    let left = parseUnary();

    while (true) {
      const token = current();
      if (!token) {
        break;
      }

      if (token.kind === "group" && token.delimiter === ")") {
        break;
      }

      if (isOperatorToken(token, "or")) {
        break;
      }

      if (isOperatorToken(token, "and")) {
        advance();
      }

      const startIndex = index;
      const right = parseUnary();
      if (!right) {
        if (index === startIndex) {
          break;
        }
        continue;
      }

      left =
        left === null
          ? right
          : {
              kind: "and",
              left,
              right,
            };
    }

    return left;
  };

  const parseOr = (): SearchExpression | null => {
    let left = parseAnd();

    while (isOperatorToken(current(), "or")) {
      advance();
      const right = parseAnd();
      if (!right) {
        continue;
      }

      left =
        left === null
          ? right
          : {
              kind: "or",
              left,
              right,
            };
    }

    return left;
  };

  return parseOr();
}

function evaluateSearchExpression(
  expression: SearchExpression,
  searchIndex: SearchIndex,
): SearchExpressionResult {
  switch (expression.kind) {
    case "term": {
      const match = matchFieldToken(searchIndex, expression.term);
      return {
        fields: match.matched ? new Set([match.field]) : new Set(),
        matched: match.matched,
        score: match.matched ? match.score : 0,
      };
    }
    case "and": {
      const left = evaluateSearchExpression(expression.left, searchIndex);
      if (!left.matched) {
        return { fields: new Set(), matched: false, score: 0 };
      }

      const right = evaluateSearchExpression(expression.right, searchIndex);
      if (!right.matched) {
        return { fields: new Set(), matched: false, score: 0 };
      }

      return {
        fields: new Set([...left.fields, ...right.fields]),
        matched: true,
        score: left.score + right.score,
      };
    }
    case "or": {
      const left = evaluateSearchExpression(expression.left, searchIndex);
      const right = evaluateSearchExpression(expression.right, searchIndex);

      if (!left.matched && !right.matched) {
        return { fields: new Set(), matched: false, score: 0 };
      }

      return {
        fields: new Set([
          ...(left.matched ? [...left.fields] : []),
          ...(right.matched ? [...right.fields] : []),
        ]),
        matched: true,
        score: (left.matched ? left.score : 0) + (right.matched ? right.score : 0),
      };
    }
    case "not": {
      const child = evaluateSearchExpression(expression.child, searchIndex);
      return {
        fields: new Set(),
        matched: !child.matched,
        score: 0,
      };
    }
  }
}

function hasPositiveSearchTerm(expression: SearchExpression, negated = false): boolean {
  switch (expression.kind) {
    case "term": {
      return !negated;
    }
    case "and":
    case "or": {
      return (
        hasPositiveSearchTerm(expression.left, negated) ||
        hasPositiveSearchTerm(expression.right, negated)
      );
    }
    case "not": {
      return hasPositiveSearchTerm(expression.child, !negated);
    }
  }
}

export function parsePrSearchQuery(query: string): PrSearchToken[] {
  return lexQueryParts(query).map(parseSearchToken);
}

export function stringifyPrSearchTokens(tokens: PrSearchToken[]): string {
  return tokens
    .map(stringifySearchToken)
    .join(" ")
    .trim()
    .replaceAll("( ", "(")
    .replaceAll(" )", ")")
    .replaceAll("! (", "!(")
    .replaceAll("- (", "-(");
}

export function searchPrs(items: SearchablePrItem[], query: string): PrSearchResult[] {
  const parsedTokens = parsePrSearchQuery(query);
  const searchExpression = buildSearchExpression(parsedTokens);

  if (!searchExpression) {
    return items.map((item) => ({
      item,
      matchedFields: [],
      score: 0,
    }));
  }

  const hasPositiveTerms = hasPositiveSearchTerm(searchExpression);
  const matches = items.flatMap((item, index) => {
    const result = evaluateSearchExpression(searchExpression, createSearchIndex(item));
    if (!result.matched) {
      return [];
    }

    return [
      {
        index,
        result: {
          item,
          matchedFields: [...result.fields],
          score: result.score,
        },
      },
    ];
  });

  if (!hasPositiveTerms) {
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
