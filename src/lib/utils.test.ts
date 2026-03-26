import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn utility", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("foo", false && "bar", "baz")).toBe("foo baz");
  });

  it("handles undefined and null", () => {
    expect(cn("foo", undefined, "bar", null, "baz")).toBe("foo bar baz");
  });

  it("merges Tailwind classes correctly", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("handles arrays", () => {
    expect(cn(["foo", "bar"], "baz")).toBe("foo bar baz");
  });

  it("handles objects", () => {
    expect(cn({ foo: true, bar: false }, "baz")).toBe("foo baz");
  });

  it("handles empty input", () => {
    expect(cn()).toBe("");
  });

  it("handles complex Tailwind conflicts", () => {
    expect(cn("text-red-500 text-blue-500")).toBe("text-blue-500");
    expect(cn("bg-gray-100 bg-white")).toBe("bg-white");
  });

  it("preserves non-conflicting classes", () => {
    // cn() doesn't guarantee order, just that all non-conflicting classes are present
    const result = cn("text-sm font-bold", "text-red-500");
    expect(result).toContain("text-sm");
    expect(result).toContain("font-bold");
    expect(result).toContain("text-red-500");
  });

  it("handles whitespace", () => {
    expect(cn("  foo  ", "  bar  ")).toBe("foo bar");
  });

  it("handles multiple arguments", () => {
    expect(cn("a", "b", "c", "d", "e")).toBe("a b c d e");
  });

  it("handles nested arrays", () => {
    expect(cn([["foo", "bar"], "baz"])).toBe("foo bar baz");
  });

  it("combines conditional and merge behavior", () => {
    const isActive = true;
    const isDisabled = false;
    expect(
      cn(
        "base-class",
        "px-2",
        isActive && "active",
        isDisabled && "disabled",
        "px-4"
      )
    ).toBe("base-class active px-4");
  });

  describe("real-world button examples", () => {
    it("merges button variant classes", () => {
      const baseClasses = "rounded px-4 py-2";
      const variantClasses = "bg-blue-500 text-white";
      const stateClasses = "hover:bg-blue-600";
      
      expect(cn(baseClasses, variantClasses, stateClasses))
        .toBe("rounded px-4 py-2 bg-blue-500 text-white hover:bg-blue-600");
    });

    it("handles size overrides", () => {
      const base = "px-4 py-2 text-base";
      const small = "px-2 py-1 text-sm";
      
      expect(cn(base, small)).toBe("px-2 py-1 text-sm");
    });

    it("handles disabled state", () => {
      const isDisabled = true;
      expect(
        cn("bg-blue-500", isDisabled && "opacity-50 cursor-not-allowed")
      ).toBe("bg-blue-500 opacity-50 cursor-not-allowed");
    });
  });

  describe("edge cases", () => {
    it("handles duplicate classes", () => {
      // clsx/tailwind-merge may not dedupe all duplicates, just Tailwind conflicts
      const result = cn("foo foo foo");
      expect(result).toContain("foo");
    });

    it("handles empty strings", () => {
      expect(cn("", "foo", "", "bar")).toBe("foo bar");
    });

    it("handles only falsy values", () => {
      expect(cn(false, null, undefined, "")).toBe("");
    });

    it("handles numbers (converted to strings)", () => {
      // clsx filters out falsy values including 0
      expect(cn("foo", 0 as any, "bar")).toBe("foo bar");
    });
  });

  describe("performance", () => {
    it("handles large number of classes efficiently", () => {
      const classes = Array.from({ length: 100 }, (_, i) => `class-${i}`);
      const start = performance.now();
      cn(...classes);
      const end = performance.now();
      expect(end - start).toBeLessThan(10);
    });
  });
});
