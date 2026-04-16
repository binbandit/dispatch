import { describe, expect, it } from "vitest";

import {
  DEFAULT_PR_FETCH_LIMIT,
  PR_FETCH_LIMIT_UNLIMITED,
  isUnlimitedPrFetchLimit,
  normalizePrFetchLimit,
} from "./pr-fetch-limit";

describe("isUnlimitedPrFetchLimit", () => {
  it('returns true for "all"', () => {
    expect(isUnlimitedPrFetchLimit("all")).toBe(true);
    expect(isUnlimitedPrFetchLimit(PR_FETCH_LIMIT_UNLIMITED)).toBe(true);
  });

  it("returns false for numeric strings", () => {
    expect(isUnlimitedPrFetchLimit("200")).toBe(false);
    expect(isUnlimitedPrFetchLimit("50")).toBe(false);
  });

  it("returns false for null and undefined", () => {
    expect(isUnlimitedPrFetchLimit(null)).toBe(false);
    expect(isUnlimitedPrFetchLimit()).toBe(false);
  });
});

describe("normalizePrFetchLimit", () => {
  it('returns "all" for unlimited value', () => {
    expect(normalizePrFetchLimit("all")).toBe("all");
  });

  it("returns valid numeric options as-is", () => {
    expect(normalizePrFetchLimit("25")).toBe(25);
    expect(normalizePrFetchLimit("50")).toBe(50);
    expect(normalizePrFetchLimit("100")).toBe(100);
    expect(normalizePrFetchLimit("200")).toBe(200);
  });

  it("returns default for invalid numeric values", () => {
    expect(normalizePrFetchLimit("75")).toBe(DEFAULT_PR_FETCH_LIMIT);
    expect(normalizePrFetchLimit("999")).toBe(DEFAULT_PR_FETCH_LIMIT);
    expect(normalizePrFetchLimit("0")).toBe(DEFAULT_PR_FETCH_LIMIT);
  });

  it("returns default for non-numeric strings", () => {
    expect(normalizePrFetchLimit("abc")).toBe(DEFAULT_PR_FETCH_LIMIT);
    expect(normalizePrFetchLimit("")).toBe(DEFAULT_PR_FETCH_LIMIT);
  });

  it("returns default for null and undefined", () => {
    expect(normalizePrFetchLimit(null)).toBe(DEFAULT_PR_FETCH_LIMIT);
    expect(normalizePrFetchLimit()).toBe(DEFAULT_PR_FETCH_LIMIT);
  });
});
