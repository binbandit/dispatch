export const PR_FETCH_LIMIT_PREFERENCE_KEY = "prFetchLimit";
export const DEFAULT_PR_FETCH_LIMIT = 200;
export const PR_FETCH_LIMIT_OPTIONS = [25, 50, 100, 200] as const;

export function normalizePrFetchLimit(value: string | null | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_PR_FETCH_LIMIT;
  }

  return PR_FETCH_LIMIT_OPTIONS.includes(parsed as (typeof PR_FETCH_LIMIT_OPTIONS)[number])
    ? parsed
    : DEFAULT_PR_FETCH_LIMIT;
}
