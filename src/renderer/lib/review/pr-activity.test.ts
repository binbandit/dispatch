import { describe, expect, it } from "vitest";

import { getPrActivityKey, hasNewPrActivity, indexPrActivityStates } from "./pr-activity";

describe("getPrActivityKey", () => {
  it("builds key from repo and PR number", () => {
    expect(getPrActivityKey("owner/repo", 42)).toBe("owner/repo::42");
  });
});

describe("indexPrActivityStates", () => {
  it("returns empty map for empty input", () => {
    expect(indexPrActivityStates([])).toEqual(new Map());
  });

  it("indexes by repo::prNumber key", () => {
    const states = [
      {
        repo: "owner/repo",
        prNumber: 1,
        lastSeenUpdatedAt: "2024-01-01T00:00:00Z",
        seenAt: "2024-01-01T00:00:00Z",
      },
      {
        repo: "owner/repo",
        prNumber: 2,
        lastSeenUpdatedAt: "2024-01-02T00:00:00Z",
        seenAt: "2024-01-02T00:00:00Z",
      },
    ];
    const map = indexPrActivityStates(states);
    expect(map.size).toBe(2);
    expect(map.get("owner/repo::1")).toBe(states[0]);
    expect(map.get("owner/repo::2")).toBe(states[1]);
  });
});

describe("hasNewPrActivity", () => {
  it("returns true when updatedAt is newer than lastSeenUpdatedAt", () => {
    expect(
      hasNewPrActivity("2024-06-02T00:00:00Z", { lastSeenUpdatedAt: "2024-06-01T00:00:00Z" }),
    ).toBe(true);
  });

  it("returns false when updatedAt equals lastSeenUpdatedAt", () => {
    expect(
      hasNewPrActivity("2024-06-01T00:00:00Z", { lastSeenUpdatedAt: "2024-06-01T00:00:00Z" }),
    ).toBe(false);
  });

  it("returns false when updatedAt is older", () => {
    expect(
      hasNewPrActivity("2024-05-31T00:00:00Z", { lastSeenUpdatedAt: "2024-06-01T00:00:00Z" }),
    ).toBe(false);
  });

  it("returns false for null activityState", () => {
    expect(hasNewPrActivity("2024-06-01T00:00:00Z", null)).toBe(false);
  });

  it("returns false for undefined activityState", () => {
    expect(hasNewPrActivity("2024-06-01T00:00:00Z")).toBe(false);
  });

  it("returns false for empty lastSeenUpdatedAt", () => {
    expect(hasNewPrActivity("2024-06-01T00:00:00Z", { lastSeenUpdatedAt: "" })).toBe(false);
  });

  it("returns false for invalid date strings", () => {
    expect(hasNewPrActivity("not-a-date", { lastSeenUpdatedAt: "2024-06-01T00:00:00Z" })).toBe(
      false,
    );
    expect(hasNewPrActivity("2024-06-01T00:00:00Z", { lastSeenUpdatedAt: "not-a-date" })).toBe(
      false,
    );
  });
});
