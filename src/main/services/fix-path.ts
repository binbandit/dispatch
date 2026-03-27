import { execFileSync } from "node:child_process";

/**
 * Fix `process.env.PATH` for macOS/Linux Electron apps.
 *
 * GUI apps on macOS inherit a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`)
 * that doesn't include Homebrew, nvm, or other user-installed tool directories.
 * This resolves the user's login shell PATH and patches `process.env.PATH` so
 * that spawned child processes (e.g. `gh`, `git`) can be found.
 *
 * Must be called once, early in the main process — before any child spawning.
 */
export function fixPath(): void {
  if (process.platform === "win32") return;

  const shell = process.env.SHELL || "/bin/zsh";

  try {
    // Ask the login shell for its PATH. `-ilc` = interactive login + command.
    // Use `printenv PATH` instead of `echo $PATH` — printenv is a standalone
    // binary that reads the env var directly, so it returns colon-separated
    // output regardless of shell (fish stores PATH as a list internally but
    // exports it colon-separated to child processes).
    const shellPath = execFileSync(shell, ["-ilc", "printenv PATH"], {
      encoding: "utf8",
      timeout: 5_000,
      // Prevent the shell from inheriting stdio (avoid tty errors)
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (shellPath) {
      process.env.PATH = shellPath;
    }
  } catch {
    // If it fails, keep the existing (limited) PATH — a degraded experience
    // is better than crashing.
    console.warn("[fix-path] Could not resolve shell PATH, using default");
  }
}
