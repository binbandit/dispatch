export const PR_FETCH_LIMIT_PREFERENCE_KEY = "prFetchLimit";
export const DEFAULT_PR_FETCH_LIMIT = 200;
export const PR_FETCH_LIMIT_UNLIMITED = "all";
export const PR_FETCH_LIMIT_MIN = 1;
export const PR_FETCH_LIMIT_MAX = 1000;
export const PR_FETCH_LIMIT_PRESET_OPTIONS = [25, 50, 100, 200] as const;
export const PR_FETCH_LIMIT_OPTIONS = [
  ...PR_FETCH_LIMIT_PRESET_OPTIONS,
  PR_FETCH_LIMIT_UNLIMITED,
] as const;

export type PrFetchLimitPreset = (typeof PR_FETCH_LIMIT_OPTIONS)[number];
export type PrFetchLimit = number | typeof PR_FETCH_LIMIT_UNLIMITED;

export function isUnlimitedPrFetchLimit(
  value?: PrFetchLimit | string | null,
): value is typeof PR_FETCH_LIMIT_UNLIMITED {
  return value === PR_FETCH_LIMIT_UNLIMITED;
}

export function isPresetPrFetchLimit(value: number): boolean {
  return (PR_FETCH_LIMIT_PRESET_OPTIONS as readonly number[]).includes(value);
}

export function normalizePrFetchLimit(value?: string | null): PrFetchLimit {
  if (isUnlimitedPrFetchLimit(value)) {
    return PR_FETCH_LIMIT_UNLIMITED;
  }

  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed) || parsed < PR_FETCH_LIMIT_MIN) {
    return DEFAULT_PR_FETCH_LIMIT;
  }

  return Math.min(parsed, PR_FETCH_LIMIT_MAX);
}
