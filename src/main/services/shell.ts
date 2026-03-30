import { execFile as execFileCb } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

const DEFAULT_TIMEOUT = 30_000;
// 10 MB for large diffs/logs
const MAX_BUFFER = 10 * 1024 * 1024;
const EXECUTABLE_CACHE = new Map<string, string>();

const EXECUTABLE_FALLBACKS: Partial<Record<string, string[]>> = {
  gh: [
    "/opt/homebrew/bin/gh",
    "/usr/local/bin/gh",
    "/Applications/GitHub CLI.app/Contents/MacOS/gh",
    "/usr/bin/gh",
  ],
  git: ["/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"],
};

const SHIM_PATH_MARKERS = [
  "/.asdf/shims",
  "/.local/share/mise/shims",
  "/.local/share/rtx/shims",
  "/.mise/shims",
  "/.nodenv/shims",
  "/.pyenv/shims",
  "/.rbenv/shims",
  "/.goenv/shims",
];

export const shellRuntime = {
  accessSync,
  execFile: execFileAsync,
};

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Execute a command with an argument array (no shell interpretation).
 * Uses `execFile` instead of `exec` to prevent shell injection.
 * Rejects if the process exits with a non-zero code.
 */
export async function execFile(
  command: string,
  args: string[],
  options: { cwd?: string; timeout?: number } = {},
): Promise<ExecResult> {
  const commandsToTry = getCommandsToTry(command);

  let lastError: unknown;
  for (const candidate of commandsToTry) {
    try {
      const { stdout, stderr } = await shellRuntime.execFile(candidate, args, {
        cwd: options.cwd,
        timeout: options.timeout ?? DEFAULT_TIMEOUT,
        maxBuffer: MAX_BUFFER,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });

      if (candidate !== command) {
        EXECUTABLE_CACHE.set(command, candidate);
      }

      return { stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (error) {
      lastError = error;

      if (!shouldRetryWithFallback(command, candidate, error)) {
        throw error;
      }
    }
  }

  throw lastError;
}

/**
 * Check if a CLI tool is available on the system PATH.
 * Returns the version string if found, null otherwise.
 */
export async function whichVersion(tool: string): Promise<string | null> {
  try {
    const { stdout } = await execFile(tool, ["--version"], { timeout: 5000 });
    return stdout;
  } catch {
    return null;
  }
}

function getCommandsToTry(command: string): string[] {
  if (command.includes("/")) {
    return [command];
  }

  const cached = EXECUTABLE_CACHE.get(command);
  if (cached) {
    return [cached, command];
  }

  const resolved = resolveExecutablePath(command);

  if (resolved && resolved !== command) {
    return [resolved, command];
  }

  return [command];
}

export function resolveExecutablePath(command: string): string | null {
  if (command.includes("/")) {
    return isExecutable(command) ? command : null;
  }

  const fallback = resolveFallbackExecutable(command);
  if (fallback) {
    return fallback;
  }

  const pathValue = process.env.PATH;
  if (!pathValue) {
    return null;
  }

  const entries = pathValue
    .split(":")
    .map((entry, index) => ({ entry: entry.trim(), index }))
    .filter((entry) => entry.entry.length > 0)
    .toSorted((left, right) => {
      const rankDifference = getPathEntryRank(left.entry) - getPathEntryRank(right.entry);
      if (rankDifference !== 0) {
        return rankDifference;
      }
      return left.index - right.index;
    });

  for (const { entry } of entries) {
    const candidate = join(entry, command);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveFallbackExecutable(command: string): string | null {
  const candidates = EXECUTABLE_FALLBACKS[command];
  if (!candidates) {
    return null;
  }

  for (const candidate of candidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

function shouldRetryWithFallback(command: string, candidate: string, error: unknown): boolean {
  if (command.includes("/")) {
    return false;
  }

  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "EACCES" || code === "EPERM" || code === "ENOEXEC";
}

export function resetExecutableCache(): void {
  EXECUTABLE_CACHE.clear();
}

function isExecutable(path: string): boolean {
  try {
    shellRuntime.accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function getPathEntryRank(entry: string): number {
  return SHIM_PATH_MARKERS.some((marker) => entry.includes(marker)) ? 1 : 0;
}
