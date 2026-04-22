import {
  getSearchStateStorageKey,
  isSearchStatePersistenceEnabled,
  SEARCH_STATE_PERSISTENCE_PREFERENCE_KEY,
} from "@/shared/search-state";
/* eslint-disable vitest/prefer-to-be-falsy, vitest/prefer-to-be-truthy -- These assertions intentionally use strict boolean matchers. */
import { describe, expect, it } from "vitest";

describe("search state preferences", () => {
  it('treats "false" as disabled', () => {
    expect(isSearchStatePersistenceEnabled("false")).toBe(false);
  });

  it("defaults to enabled for nullish or truthy values", () => {
    expect(isSearchStatePersistenceEnabled(null)).toBe(true);
    expect(isSearchStatePersistenceEnabled()).toBe(true);
    expect(isSearchStatePersistenceEnabled("true")).toBe(true);
  });

  it("builds stable storage keys", () => {
    expect(getSearchStateStorageKey("home:acme/dispatch")).toBe(
      "dispatch.search-state:home:acme/dispatch",
    );
  });

  it("exports the preference key", () => {
    expect(SEARCH_STATE_PERSISTENCE_PREFERENCE_KEY).toBe("persistSearchState");
  });
});
