export const SEARCH_STATE_PERSISTENCE_PREFERENCE_KEY = "persistSearchState";

export function isSearchStatePersistenceEnabled(value?: string | null): boolean {
  return value !== "false";
}

export function getSearchStateStorageKey(scope: string): string {
  return `dispatch.search-state:${scope}`;
}
