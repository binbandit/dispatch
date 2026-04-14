import { describe, expect, it } from "vitest";

import { summarizePrChecks } from "./pr-check-status";

describe("summarizePrChecks", () => {
  it('returns state "none" for empty checks', () => {
    const result = summarizePrChecks([]);
    expect(result).toEqual({
      total: 0,
      passed: 0,
      failed: 0,
      pending: 0,
      neutral: 0,
      state: "none",
    });
  });

  it('returns "passing" when all checks succeed', () => {
    const result = summarizePrChecks([
      { status: "COMPLETED", conclusion: "success" },
      { status: "COMPLETED", conclusion: "SUCCESS" },
    ]);
    expect(result.state).toBe("passing");
    expect(result.passed).toBe(2);
    expect(result.total).toBe(2);
  });

  it('returns "failing" when any check fails', () => {
    const result = summarizePrChecks([
      { status: "COMPLETED", conclusion: "success" },
      { status: "COMPLETED", conclusion: "failure" },
    ]);
    expect(result.state).toBe("failing");
    expect(result.failed).toBe(1);
    expect(result.passed).toBe(1);
  });

  it('returns "pending" when checks are in progress', () => {
    const result = summarizePrChecks([
      { status: "COMPLETED", conclusion: "success" },
      { status: "in_progress", conclusion: null },
    ]);
    expect(result.state).toBe("pending");
    expect(result.pending).toBe(1);
  });

  it("counts all failing conclusion types", () => {
    const failConclusions = ["action_required", "error", "failure", "startup_failure", "timed_out"];
    const result = summarizePrChecks(
      failConclusions.map((conclusion) => ({ status: "COMPLETED", conclusion })),
    );
    expect(result.failed).toBe(5);
    expect(result.state).toBe("failing");
  });

  it("counts pending statuses correctly", () => {
    const pendingStatuses = [
      "expected",
      "in_progress",
      "pending",
      "queued",
      "requested",
      "waiting",
    ];
    const result = summarizePrChecks(
      pendingStatuses.map((status) => ({ status, conclusion: null })),
    );
    expect(result.pending).toBe(6);
    expect(result.state).toBe("pending");
  });

  it('returns "neutral" when checks have non-standard conclusions', () => {
    const result = summarizePrChecks([
      { status: "COMPLETED", conclusion: "skipped" },
      { status: "COMPLETED", conclusion: "cancelled" },
    ]);
    expect(result.state).toBe("neutral");
    expect(result.neutral).toBe(2);
  });

  it("failing takes precedence over pending", () => {
    const result = summarizePrChecks([
      { status: "COMPLETED", conclusion: "failure" },
      { status: "in_progress", conclusion: null },
      { status: "COMPLETED", conclusion: "success" },
    ]);
    expect(result.state).toBe("failing");
  });

  it("pending takes precedence over passing", () => {
    const result = summarizePrChecks([
      { status: "COMPLETED", conclusion: "success" },
      { status: "queued", conclusion: null },
    ]);
    expect(result.state).toBe("pending");
  });

  it("handles case-insensitive conclusions", () => {
    const result = summarizePrChecks([
      { status: "COMPLETED", conclusion: "SUCCESS" },
      { status: "COMPLETED", conclusion: "FAILURE" },
    ]);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("handles whitespace in conclusion values", () => {
    const result = summarizePrChecks([{ status: "COMPLETED", conclusion: "  success  " }]);
    expect(result.passed).toBe(1);
  });

  it("total always equals sum of categories", () => {
    const result = summarizePrChecks([
      { status: "COMPLETED", conclusion: "success" },
      { status: "COMPLETED", conclusion: "failure" },
      { status: "queued", conclusion: null },
      { status: "COMPLETED", conclusion: "skipped" },
    ]);
    expect(result.total).toBe(result.passed + result.failed + result.pending + result.neutral);
  });

  it("handles single passing check", () => {
    const result = summarizePrChecks([{ status: "COMPLETED", conclusion: "success" }]);
    expect(result.state).toBe("passing");
    expect(result.total).toBe(1);
  });

  it("handles single failing check", () => {
    const result = summarizePrChecks([{ status: "COMPLETED", conclusion: "failure" }]);
    expect(result.state).toBe("failing");
  });

  it("handles null status with null conclusion as pending", () => {
    const result = summarizePrChecks([{ conclusion: null }]);
    expect(result.pending).toBe(1);
    expect(result.state).toBe("pending");
  });

  it("neutral + passing = neutral", () => {
    const result = summarizePrChecks([
      { status: "COMPLETED", conclusion: "success" },
      { status: "COMPLETED", conclusion: "skipped" },
    ]);
    expect(result.state).toBe("neutral");
  });

  it("handles large number of checks", () => {
    const checks = Array.from({ length: 50 }, () => ({
      status: "COMPLETED",
      conclusion: "success",
    }));
    const result = summarizePrChecks(checks);
    expect(result.passed).toBe(50);
    expect(result.state).toBe("passing");
  });
});
