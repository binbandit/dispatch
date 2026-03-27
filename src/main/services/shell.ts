import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

const DEFAULT_TIMEOUT = 30_000;
// 10 MB for large diffs/logs
const MAX_BUFFER = 10 * 1024 * 1024;

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
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: options.cwd,
    timeout: options.timeout ?? DEFAULT_TIMEOUT,
    maxBuffer: MAX_BUFFER,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });

  return { stdout: stdout.trim(), stderr: stderr.trim() };
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
