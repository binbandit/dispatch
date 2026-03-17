import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(execCb);

const DEFAULT_TIMEOUT = 30_000;

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Execute a shell command and return stdout/stderr.
 * Rejects if the process exits with a non-zero code.
 */
export async function exec(
  command: string,
  options: { cwd?: string; timeout?: number } = {},
): Promise<ExecResult> {
  const { stdout, stderr } = await execAsync(command, {
    cwd: options.cwd,
    timeout: options.timeout ?? DEFAULT_TIMEOUT,
    maxBuffer: 10 * 1024 * 1024, // 10 MB for large diffs/logs
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
    const { stdout } = await exec(`${tool} --version`, { timeout: 5_000 });
    return stdout;
  } catch {
    return null;
  }
}
