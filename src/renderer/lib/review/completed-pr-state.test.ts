import {
  getCompletedPullRequestLabel,
  getCompletedPullRequestTimestamp,
  isCompletedPullRequest,
} from "@/renderer/lib/review/completed-pr-state";
import { describe, expect, it } from "vitest";

describe("completed-pr-state", () => {
  it("treats merged and closed pull requests as completed", () => {
    expect(isCompletedPullRequest({ state: "OPEN" })).toBeFalsy();
    expect(isCompletedPullRequest({ state: "CLOSED" })).toBeTruthy();
    expect(isCompletedPullRequest({ state: "MERGED" })).toBeTruthy();
  });

  it("returns the correct completed label", () => {
    expect(getCompletedPullRequestLabel("OPEN")).toBeNull();
    expect(getCompletedPullRequestLabel("CLOSED")).toBe("Closed");
    expect(getCompletedPullRequestLabel("MERGED")).toBe("Merged");
  });

  it("prefers mergedAt for merged pull requests", () => {
    expect(
      getCompletedPullRequestTimestamp({
        state: "MERGED",
        closedAt: "2026-04-01T00:00:00Z",
        mergedAt: "2026-04-01T01:00:00Z",
      }),
    ).toBe("2026-04-01T01:00:00Z");
  });

  it("falls back to closedAt for closed pull requests", () => {
    expect(
      getCompletedPullRequestTimestamp({
        state: "CLOSED",
        closedAt: "2026-04-01T00:00:00Z",
        mergedAt: null,
      }),
    ).toBe("2026-04-01T00:00:00Z");
  });
});
