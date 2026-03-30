import { execFileSync } from "node:child_process";

const PATH_SENTINEL_START = "__DISPATCH_PATH_START__";
const PATH_SENTINEL_END = "__DISPATCH_PATH_END__";

export const fixPathRuntime = {
  execFileSync,
};

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

  const resolved = resolveFromShell() ?? resolveFromPathHelper();
  const merged = mergePaths(resolved, process.env.PATH);
  if (merged) {
    process.env.PATH = merged;
  }
}

/**
 * Ask the user's login shell for its PATH.
 *
 * First tries an interactive login shell so we inherit PATH changes commonly
 * added in files like `.zshrc`. A sentinel wraps `printenv PATH` so startup
 * noise does not corrupt the parsed value.
 *
 * Falls back to a non-interactive login shell for environments where `-i`
 * is unsupported or misbehaves.
 */
function resolveFromShell(): string | null {
  const shell = process.env.SHELL || "/bin/zsh";

  return (
    readPathFromShell(shell, [
      "-i",
      "-l",
      "-c",
      `printf '${PATH_SENTINEL_START}'; printenv PATH; printf '${PATH_SENTINEL_END}'`,
    ]) ?? readPathFromShell(shell, ["-l", "-c", "printenv PATH"])
  );
}

/**
 * macOS fallback: use `/usr/libexec/path_helper` to read system-configured
 * paths from `/etc/paths` and `/etc/paths.d/*`.
 *
 * This catches Homebrew (`/opt/homebrew/bin`) and other system-level tool
 * directories without needing any user shell. Won't include user-specific
 * PATH entries from shell configs, but is enough to find gh/git.
 */
function resolveFromPathHelper(): string | null {
  if (process.platform !== "darwin") return null;

  try {
    const output = fixPathRuntime
      .execFileSync("/usr/libexec/path_helper", ["-s"], {
        encoding: "utf8",
        timeout: 3_000,
      })
      .trim();

    // path_helper outputs: PATH="..."; export PATH;
    const match = output.match(/PATH="([^"]+)"/);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // path_helper not available or failed.
  }

  return null;
}

function readPathFromShell(shell: string, args: string[]): string | null {
  try {
    const output = fixPathRuntime
      .execFileSync(shell, args, {
        encoding: "utf8",
        timeout: 5_000,
        stdio: ["ignore", "pipe", "ignore"],
      })
      .trim();

    return extractPath(output);
  } catch {
    // Shell failed (timeout, unsupported flags, etc.) — fall through.
    return null;
  }
}

function extractPath(output: string): string | null {
  const startIndex = output.lastIndexOf(PATH_SENTINEL_START);
  if (startIndex !== -1) {
    const pathStart = startIndex + PATH_SENTINEL_START.length;
    const endIndex = output.indexOf(PATH_SENTINEL_END, pathStart);
    if (endIndex !== -1) {
      const extracted = output.slice(pathStart, endIndex).trim();
      if (extracted.includes("/")) {
        return extracted;
      }
    }
  }

  const lastLine = output.includes("\n") ? output.split("\n").pop()!.trim() : output;
  if (lastLine.includes("/")) {
    return lastLine;
  }

  return null;
}

function mergePaths(resolvedPath: string | null, currentPath: string | undefined): string | null {
  const segments = [resolvedPath, currentPath]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(":"))
    .map((value) => value.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  return [...new Set(segments)].join(":");
}
