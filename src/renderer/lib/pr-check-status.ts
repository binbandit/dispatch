interface PrStatusCheck {
  status?: string | null;
  conclusion: string | null;
}

export type PrCheckSummaryState = "failing" | "pending" | "passing" | "neutral" | "none";

export interface PrCheckSummary {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  neutral: number;
  state: PrCheckSummaryState;
}

const FAILING_CONCLUSIONS = new Set([
  "action_required",
  "error",
  "failure",
  "startup_failure",
  "timed_out",
]);

const PENDING_STATUSES = new Set([
  "expected",
  "in_progress",
  "pending",
  "queued",
  "requested",
  "waiting",
]);

function normalize(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.trim().toLowerCase();
}

export function summarizePrChecks(checks: PrStatusCheck[]): PrCheckSummary {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  let neutral = 0;

  for (const check of checks) {
    const conclusion = normalize(check.conclusion);
    const status = normalize(check.status);

    if (conclusion === "success") {
      passed += 1;
    } else if (conclusion !== null && FAILING_CONCLUSIONS.has(conclusion)) {
      failed += 1;
    } else if (conclusion === null || (status !== null && PENDING_STATUSES.has(status))) {
      pending += 1;
    } else {
      neutral += 1;
    }
  }

  const total = checks.length;
  let state: PrCheckSummaryState = "none";

  if (total > 0) {
    if (failed > 0) {
      state = "failing";
    } else if (pending > 0) {
      state = "pending";
    } else if (passed === total) {
      state = "passing";
    } else {
      state = "neutral";
    }
  }

  return {
    total,
    passed,
    failed,
    pending,
    neutral,
    state,
  };
}
