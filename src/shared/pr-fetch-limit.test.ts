import { describe, expect, it } from "vitest";

import {
  DEFAULT_PR_FETCH_LIMIT,
  PR_FETCH_LIMIT_UNLIMITED,
  normalizePrFetchLimit,
} from "./pr-fetch-limit";

describe("normalizePrFetchLimit", () => {
  it("preserves the unlimited sentinel", () => {
    expect(normalizePrFetchLimit(PR_FETCH_LIMIT_UNLIMITED)).toBe(PR_FETCH_LIMIT_UNLIMITED);
  });

  it("falls back to the default for unknown values", () => {
    expect(normalizePrFetchLimit("999")).toBe(DEFAULT_PR_FETCH_LIMIT);
    expect(normalizePrFetchLimit("banana")).toBe(DEFAULT_PR_FETCH_LIMIT);
  });
});
