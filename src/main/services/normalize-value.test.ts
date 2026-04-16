import { describe, expect, it } from "vitest";

import { normalizeValue } from "./normalize-value";

describe("normalizeValue", () => {
  it("returns trimmed string for valid input", () => {
    expect(normalizeValue("hello")).toBe("hello");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeValue("  hello  ")).toBe("hello");
    expect(normalizeValue("\thello\n")).toBe("hello");
  });

  it("returns null for empty string", () => {
    expect(normalizeValue("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(normalizeValue("   ")).toBeNull();
    expect(normalizeValue("\t\n")).toBeNull();
  });

  it("returns null for null", () => {
    expect(normalizeValue(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(normalizeValue()).toBeNull();
  });

  it("returns null for non-string types", () => {
    expect(normalizeValue(42)).toBeNull();
    expect(normalizeValue(true)).toBeNull();
    expect(normalizeValue({})).toBeNull();
    expect(normalizeValue([])).toBeNull();
  });
});
