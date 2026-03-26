import { describe, expect, it } from "vitest";

import { clamp, relativeTime } from "./format";

describe("clamp", () => {
  it("returns the value when within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to minimum when value is below range", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps to maximum when value is above range", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("handles equal min and max", () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });

  it("handles negative ranges", () => {
    expect(clamp(-5, -10, -1)).toBe(-5);
    expect(clamp(-15, -10, -1)).toBe(-10);
    expect(clamp(0, -10, -1)).toBe(-1);
  });

  it("handles zero values", () => {
    expect(clamp(0, -5, 5)).toBe(0);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(0, -10, 0)).toBe(0);
  });

  it("handles floating point values", () => {
    expect(clamp(3.5, 0, 10)).toBe(3.5);
    expect(clamp(0.1, 0, 1)).toBe(0.1);
    expect(clamp(10.5, 0, 10)).toBe(10);
  });

  it("handles very large numbers", () => {
    expect(clamp(Number.MAX_SAFE_INTEGER, 0, 100)).toBe(100);
    expect(clamp(Number.MIN_SAFE_INTEGER, 0, 100)).toBe(0);
  });

  it("handles value exactly at minimum", () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  it("handles value exactly at maximum", () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });

  describe("edge cases", () => {
    it("handles min > max (unusual but should work)", () => {
      // Math.min(Math.max(5, 10), 0) = Math.min(10, 0) = 0
      expect(clamp(5, 10, 0)).toBe(0);
    });

    it("handles Infinity", () => {
      expect(clamp(Infinity, 0, 10)).toBe(10);
      expect(clamp(-Infinity, 0, 10)).toBe(0);
    });

    it("handles NaN (returns NaN)", () => {
      expect(clamp(NaN, 0, 10)).toBeNaN();
    });
  });

  describe("real-world use cases", () => {
    it("clamps volume (0-100)", () => {
      expect(clamp(150, 0, 100)).toBe(100);
      expect(clamp(-10, 0, 100)).toBe(0);
      expect(clamp(50, 0, 100)).toBe(50);
    });

    it("clamps percentage (0-1)", () => {
      expect(clamp(1.5, 0, 1)).toBe(1);
      expect(clamp(-0.5, 0, 1)).toBe(0);
      expect(clamp(0.75, 0, 1)).toBe(0.75);
    });

    it("clamps array index", () => {
      const arrayLength = 10;
      expect(clamp(15, 0, arrayLength - 1)).toBe(9);
      expect(clamp(-1, 0, arrayLength - 1)).toBe(0);
    });
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-01-01T12:00:00Z");

  it('returns "just now" for times less than a minute ago', () => {
    const date = new Date("2026-01-01T11:59:30Z");
    expect(relativeTime(date, now)).toBe("just now");
  });

  it("returns minutes ago", () => {
    const date = new Date("2026-01-01T11:55:00Z");
    expect(relativeTime(date, now)).toBe("5 minutes ago");
  });

  it("returns singular minute", () => {
    const date = new Date("2026-01-01T11:59:00Z");
    expect(relativeTime(date, now)).toBe("1 minute ago");
  });

  it("returns hours ago", () => {
    const date = new Date("2026-01-01T09:00:00Z");
    expect(relativeTime(date, now)).toBe("3 hours ago");
  });

  it("returns singular hour", () => {
    const date = new Date("2026-01-01T11:00:00Z");
    expect(relativeTime(date, now)).toBe("1 hour ago");
  });

  it("returns days ago", () => {
    const date = new Date("2025-12-30T12:00:00Z");
    expect(relativeTime(date, now)).toBe("2 days ago");
  });

  it("returns singular day", () => {
    const date = new Date("2025-12-31T12:00:00Z");
    expect(relativeTime(date, now)).toBe("1 day ago");
  });

  describe("edge cases", () => {
    it('returns "just now" for future dates', () => {
      const future = new Date("2026-01-01T12:01:00Z");
      expect(relativeTime(future, now)).toBe("just now");
    });

    it('returns "just now" for same date', () => {
      expect(relativeTime(now, now)).toBe("just now");
    });

    it('returns "just now" for invalid date', () => {
      const invalid = new Date("invalid");
      expect(relativeTime(invalid, now)).toBe("just now");
    });

    it("handles date exactly 1 minute ago", () => {
      const date = new Date("2026-01-01T11:59:00Z");
      expect(relativeTime(date, now)).toBe("1 minute ago");
    });

    it("handles date exactly 1 hour ago", () => {
      const date = new Date("2026-01-01T11:00:00Z");
      expect(relativeTime(date, now)).toBe("1 hour ago");
    });

    it("handles date exactly 1 day ago", () => {
      const date = new Date("2025-12-31T12:00:00Z");
      expect(relativeTime(date, now)).toBe("1 day ago");
    });

    it("handles 59 seconds (just now)", () => {
      const date = new Date(now.getTime() - 59 * 1000);
      expect(relativeTime(date, now)).toBe("just now");
    });

    it("handles 60 seconds (1 minute)", () => {
      const date = new Date(now.getTime() - 60 * 1000);
      expect(relativeTime(date, now)).toBe("1 minute ago");
    });

    it("handles 59 minutes", () => {
      const date = new Date(now.getTime() - 59 * 60 * 1000);
      expect(relativeTime(date, now)).toBe("59 minutes ago");
    });

    it("handles 60 minutes (1 hour)", () => {
      const date = new Date(now.getTime() - 60 * 60 * 1000);
      expect(relativeTime(date, now)).toBe("1 hour ago");
    });

    it("handles 23 hours", () => {
      const date = new Date(now.getTime() - 23 * 60 * 60 * 1000);
      expect(relativeTime(date, now)).toBe("23 hours ago");
    });

    it("handles 24 hours (1 day)", () => {
      const date = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      expect(relativeTime(date, now)).toBe("1 day ago");
    });

    it("handles very old dates", () => {
      const date = new Date("2025-01-01T12:00:00Z");
      const result = relativeTime(date, now);
      expect(result).toMatch(/\d+ days? ago/);
      expect(result).toBe("365 days ago");
    });

    it("handles dates with milliseconds", () => {
      const date = new Date(now.getTime() - 90 * 1000 - 500); // 90.5 seconds ago
      expect(relativeTime(date, now)).toBe("1 minute ago");
    });
  });

  describe("uses current time when now not provided", () => {
    it("calculates relative to Date.now()", () => {
      const recent = new Date(Date.now() - 30 * 1000); // 30 seconds ago
      expect(relativeTime(recent)).toBe("just now");
    });
  });

  describe("real-world scenarios", () => {
    it("recent comment (2 minutes ago)", () => {
      const date = new Date("2026-01-01T11:58:00Z");
      expect(relativeTime(date, now)).toBe("2 minutes ago");
    });

    it("PR created this morning (3 hours ago)", () => {
      const date = new Date("2026-01-01T09:00:00Z");
      expect(relativeTime(date, now)).toBe("3 hours ago");
    });

    it("last commit yesterday (1 day ago)", () => {
      const date = new Date("2025-12-31T12:00:00Z");
      expect(relativeTime(date, now)).toBe("1 day ago");
    });

    it("PR opened last week (7 days ago)", () => {
      const date = new Date("2025-12-25T12:00:00Z");
      expect(relativeTime(date, now)).toBe("7 days ago");
    });
  });

  describe("pluralization", () => {
    const testCases = [
      { offset: 1, unit: "minute", expected: "1 minute ago" },
      { offset: 2, unit: "minute", expected: "2 minutes ago" },
      { offset: 1, unit: "hour", expected: "1 hour ago" },
      { offset: 2, unit: "hour", expected: "2 hours ago" },
      { offset: 1, unit: "day", expected: "1 day ago" },
      { offset: 2, unit: "day", expected: "2 days ago" },
    ];

    for (const { offset, unit, expected } of testCases) {
      it(`correctly pluralizes ${offset} ${unit}`, () => {
        let date: Date;
        if (unit === "minute") {
          date = new Date(now.getTime() - offset * 60 * 1000);
        } else if (unit === "hour") {
          date = new Date(now.getTime() - offset * 60 * 60 * 1000);
        } else {
          date = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
        }
        expect(relativeTime(date, now)).toBe(expected);
      });
    }
  });

  describe("boundary values", () => {
    it("handles date at Unix epoch", () => {
      const epoch = new Date(0);
      const result = relativeTime(epoch, now);
      expect(result).toMatch(/\d+ days? ago/);
    });

    it("handles very recent date (1 second ago)", () => {
      const date = new Date(now.getTime() - 1000);
      expect(relativeTime(date, now)).toBe("just now");
    });

    it("handles date way in the past (100 years)", () => {
      const old = new Date("1926-01-01T12:00:00Z");
      const result = relativeTime(old, now);
      expect(result).toMatch(/\d+ days? ago/);
    });
  });
});
