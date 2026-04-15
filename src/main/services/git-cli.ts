import type { BlameLine, DevRepoStatus } from "../../shared/ipc";

import { execFile } from "./shell";

/**
 * Local Git CLI adapter.
 *
 * Provides blame, log, and diff operations on the user's local clone.
 * All commands use `execFile` (argument arrays) to prevent shell injection.
 */

// ---------------------------------------------------------------------------
// Blame
// ---------------------------------------------------------------------------

export async function blame(args: {
  cwd: string;
  file: string;
  line: number;
  ref: string;
}): Promise<BlameLine> {
  let stdout = "";
  try {
    const result = await execFile(
      "git",
      ["blame", "-L", `${args.line},${args.line}`, args.ref, "--porcelain", "--", args.file],
      { cwd: args.cwd },
    );
    ({ stdout } = result);
  } catch {
    // Line out of range, file doesn't exist at ref, etc.
    return { sha: "", author: "", date: "", summary: "" };
  }

  const lines = stdout.split("\n");
  const sha = lines[0]?.split(" ")[0] ?? "";

  let author = "";
  let date = "";
  let summary = "";

  for (const l of lines) {
    if (l.startsWith("author ")) {
      author = l.slice(7);
    } else if (l.startsWith("author-time ")) {
      date = new Date(Number(l.slice(12)) * 1000).toISOString();
    } else if (l.startsWith("summary ")) {
      summary = l.slice(8);
    }
  }

  return { sha, author, date, summary };
}

export async function getMergeBase(
  cwd: string,
  refA: string,
  refB: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFile("git", ["merge-base", refA, refB], { cwd });
    return stdout || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// File history
// ---------------------------------------------------------------------------

const GIT_STATUS_TIMEOUT = 5000;
const GIT_FETCH_TIMEOUT = 15_000;

function emptyDevRepoStatus(overrides: Partial<DevRepoStatus> = {}): DevRepoStatus {
  return {
    enabled: false,
    hasUpdates: false,
    currentBranch: null,
    upstreamBranch: null,
    aheadCount: 0,
    behindCount: 0,
    ...overrides,
  };
}

export function parseAheadBehindCounts(
  stdout: string,
): Pick<DevRepoStatus, "aheadCount" | "behindCount"> {
  const [aheadText = "0", behindText = "0"] = stdout.trim().split(/\s+/);
  const aheadCount = Number.parseInt(aheadText, 10);
  const behindCount = Number.parseInt(behindText, 10);

  return {
    aheadCount: Number.isNaN(aheadCount) ? 0 : aheadCount,
    behindCount: Number.isNaN(behindCount) ? 0 : behindCount,
  };
}

async function getCurrentBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFile("git", ["branch", "--show-current"], {
      cwd,
      timeout: GIT_STATUS_TIMEOUT,
    });
    return stdout || null;
  } catch {
    return null;
  }
}

async function getUpstreamBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFile(
      "git",
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      {
        cwd,
        timeout: GIT_STATUS_TIMEOUT,
      },
    );
    return stdout || null;
  } catch {
    return null;
  }
}

async function fetchUpstream(cwd: string, upstreamBranch: string): Promise<void> {
  const [remoteName] = upstreamBranch.split("/");
  if (!remoteName) {
    return;
  }

  try {
    await execFile("git", ["fetch", "--quiet", "--no-tags", "--prune", remoteName], {
      cwd,
      timeout: GIT_FETCH_TIMEOUT,
    });
  } catch {
    // Keep going with the last fetched remote-tracking ref if the fetch fails.
  }
}

export async function getDevRepoStatus(cwd: string): Promise<DevRepoStatus> {
  const currentBranch = await getCurrentBranch(cwd);
  if (!currentBranch) {
    return emptyDevRepoStatus({ enabled: true });
  }

  const upstreamBranch = await getUpstreamBranch(cwd);
  if (!upstreamBranch) {
    return emptyDevRepoStatus({
      enabled: true,
      currentBranch,
    });
  }

  await fetchUpstream(cwd, upstreamBranch);

  try {
    const { stdout } = await execFile(
      "git",
      ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
      {
        cwd,
        timeout: GIT_STATUS_TIMEOUT,
      },
    );
    const { aheadCount, behindCount } = parseAheadBehindCounts(stdout);

    return {
      enabled: true,
      hasUpdates: behindCount > 0,
      currentBranch,
      upstreamBranch,
      aheadCount,
      behindCount,
    };
  } catch {
    return emptyDevRepoStatus({
      enabled: true,
      currentBranch,
      upstreamBranch,
    });
  }
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export async function diff(cwd: string, fromRef: string, toRef: string): Promise<string> {
  const { stdout } = await execFile("git", ["diff", `${fromRef}..${toRef}`], { cwd });
  return stdout;
}

/** Get the patch (unified diff) for a single commit. */
export async function commitDiff(cwd: string, sha: string): Promise<string> {
  const { stdout } = await execFile("git", ["show", "--format=", "--patch", sha], {
    cwd,
    timeout: 15_000,
  });
  return stdout;
}

export async function commitHasReviewableChanges(cwd: string, sha: string): Promise<boolean> {
  const diff = await commitDiff(cwd, sha);
  return diff.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Repository info
// ---------------------------------------------------------------------------

export async function getRepoRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFile("git", ["rev-parse", "--show-toplevel"], { cwd });
    return stdout;
  } catch {
    return null;
  }
}
