import { exec, whichVersion } from "./shell";

/**
 * Local Git CLI adapter.
 *
 * Provides blame, log, and diff operations on the user's local clone.
 */

export async function getGitVersion(): Promise<string | null> {
  return whichVersion("git");
}

// ---------------------------------------------------------------------------
// Blame
// ---------------------------------------------------------------------------

export interface BlameLine {
  sha: string;
  author: string;
  date: string;
  summary: string;
}

export async function blame(
  cwd: string,
  file: string,
  line: number,
  ref: string,
): Promise<BlameLine> {
  const { stdout } = await exec(
    `git blame -L ${line},${line} ${ref} --porcelain -- "${file}"`,
    { cwd },
  );

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

// ---------------------------------------------------------------------------
// File history
// ---------------------------------------------------------------------------

export interface LogEntry {
  sha: string;
  author: string;
  date: string;
  message: string;
}

export async function fileHistory(
  cwd: string,
  filePath: string,
  limit = 20,
): Promise<LogEntry[]> {
  const separator = "---DISPATCH_LOG_SEP---";
  const format = `%H${separator}%an${separator}%aI${separator}%s`;

  const { stdout } = await exec(
    `git log --follow -n ${limit} --format="${format}" -- "${filePath}"`,
    { cwd },
  );

  if (!stdout) {
    return [];
  }

  return stdout.split("\n").map((line) => {
    const [sha = "", author = "", date = "", message = ""] = line.split(separator);
    return { sha, author, date, message };
  });
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export async function diff(
  cwd: string,
  fromRef: string,
  toRef: string,
): Promise<string> {
  const { stdout } = await exec(`git diff ${fromRef}..${toRef}`, { cwd });
  return stdout;
}

export async function diffStat(
  cwd: string,
  fromRef: string,
  toRef: string,
): Promise<string> {
  const { stdout } = await exec(`git diff --stat ${fromRef}..${toRef}`, { cwd });
  return stdout;
}

// ---------------------------------------------------------------------------
// Repository info
// ---------------------------------------------------------------------------

export async function getRepoRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await exec("git rev-parse --show-toplevel", { cwd });
    return stdout;
  } catch {
    return null;
  }
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  const { stdout } = await exec("git rev-parse --abbrev-ref HEAD", { cwd });
  return stdout;
}
