import { describe, expect, it } from "vitest";

import { getPrActivityKey, hasNewPrActivity, indexPrActivityStates } from "./pr-activity";

describe("getPrActivityKey", () => {
  it("builds a stable composite key from repo and PR number", () => {
    expect(getPrActivityKey("/repos/dispatch", 42)).toBe("/repos/dispatch::42");
  });
});

describe("indexPrActivityStates", () => {
  it("indexes activity state by composite repo and PR key", () => {
    const indexed = indexPrActivityStates([
      {
        repo: "/repos/dispatch",
        prNumber: 42,
        lastSeenUpdatedAt: "2026-03-20T10:00:00Z",
        seenAt: "2026-03-20 20:00:00",
      },
    ]);

    expect(indexed.get(getPrActivityKey("/repos/dispatch", 42))).toEqual({
      repo: "/repos/dispatch",
      prNumber: 42,
      lastSeenUpdatedAt: "2026-03-20T10:00:00Z",
      seenAt: "2026-03-20 20:00:00",
    });
  });
});

describe("hasNewPrActivity", () => {
  it("returns false when the PR has never been seen", () => {
    expect(hasNewPrActivity("2026-03-20T10:05:00Z", null)).toBeFalsy();
  });

  it("returns true when the current update is newer than the last seen update", () => {
    expect(
      hasNewPrActivity("2026-03-20T10:05:00Z", {
        lastSeenUpdatedAt: "2026-03-20T10:00:00Z",
      }),
    ).toBeTruthy();
  });

  it("returns false when the current update matches the last seen update", () => {
    expect(
      hasNewPrActivity("2026-03-20T10:05:00Z", {
        lastSeenUpdatedAt: "2026-03-20T10:05:00Z",
      }),
    ).toBeFalsy();
  });

  it("returns false when either timestamp is invalid", () => {
    expect(
      hasNewPrActivity("not-a-date", {
        lastSeenUpdatedAt: "2026-03-20T10:05:00Z",
      }),
    ).toBeFalsy();

    expect(
      hasNewPrActivity("2026-03-20T10:05:00Z", {
        lastSeenUpdatedAt: "not-a-date",
      }),
    ).toBeFalsy();
  });
});
