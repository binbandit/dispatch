/* eslint-disable vitest/prefer-to-be-falsy, vitest/prefer-to-be-truthy -- These assertions intentionally use strict boolean matchers. */
import { describe, expect, it } from "vitest";

import { isAiEnabledPreference } from "./use-preference";

describe("isAiEnabledPreference", () => {
  it('returns false when value is "false"', () => {
    expect(isAiEnabledPreference("false")).toBe(false);
  });

  it('returns true when value is "true"', () => {
    expect(isAiEnabledPreference("true")).toBe(true);
  });

  it("returns true when value is null", () => {
    expect(isAiEnabledPreference(null)).toBe(true);
  });

  it("returns true when value is undefined", () => {
    expect(isAiEnabledPreference()).toBe(true);
  });

  it("returns true for any non-false string", () => {
    expect(isAiEnabledPreference("yes")).toBe(true);
    expect(isAiEnabledPreference("")).toBe(true);
  });
});
