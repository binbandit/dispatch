import { execFileSync } from "node:child_process";

const SHELL_ENV_SENTINEL_START = Buffer.from("__DISPATCH_ENV_START__");
const SHELL_ENV_SENTINEL_END = Buffer.from("__DISPATCH_ENV_END__");
const SHELL_ENV_COMMAND = "printf '__DISPATCH_ENV_START__'; env -0; printf '__DISPATCH_ENV_END__'";
const SHELL_ENV_KEYS_TO_SKIP = new Set(["OLDPWD", "PWD", "SHLVL", "_"]);

export const fixPathRuntime = {
  execFileSync,
};

/**
 * Restore the user's login-shell environment for macOS/Linux Electron apps.
 *
 * GUI apps on macOS inherit a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`)
 * that doesn't include Homebrew, nvm, mise/asdf shims, or other user-installed
 * tool directories and manager variables. This imports the login-shell
 * environment early so spawned child processes (e.g. `gh`, `git`, `npx`) run
 * with the same tool discovery context as the user's terminal session.
 *
 * Must be called once, early in the main process — before any child spawning.
 */
export function fixPath(): void {
  if (process.platform === "win32") {
    return;
  }

  const shellEnvironment = resolveFromShell();
  if (shellEnvironment) {
    applyShellEnvironment(shellEnvironment);
    return;
  }

  const resolvedPath = resolveFromPathHelper();
  const mergedPath = mergePaths(resolvedPath, process.env.PATH);
  if (mergedPath) {
    process.env.PATH = mergedPath;
  }
}

/**
 * Ask the user's login shell for its exported environment.
 *
 * First tries an interactive login shell so we inherit tool-manager variables
 * commonly added in files like `.zshrc`. A sentinel wraps `env -0` so startup
 * noise does not corrupt the parsed payload.
 *
 * Falls back to a non-interactive login shell for environments where `-i`
 * is unsupported or misbehaves.
 */
function resolveFromShell(): Record<string, string> | null {
  const shell = process.env.SHELL || "/bin/zsh";

  return (
    readEnvironmentFromShell(shell, ["-i", "-l", "-c", SHELL_ENV_COMMAND]) ??
    readEnvironmentFromShell(shell, ["-l", "-c", SHELL_ENV_COMMAND])
  );
}

/**
 * MacOS fallback: use `/usr/libexec/path_helper` to read system-configured
 * paths from `/etc/paths` and `/etc/paths.d/*`.
 *
 * This catches Homebrew (`/opt/homebrew/bin`) and other system-level tool
 * directories without needing any user shell. Won't include user-specific
 * PATH entries from shell configs, but is enough to find gh/git.
 */
function resolveFromPathHelper(): string | null {
  if (process.platform !== "darwin") {
    return null;
  }

  try {
    const output = fixPathRuntime
      .execFileSync("/usr/libexec/path_helper", ["-s"], {
        encoding: "utf8",
        timeout: 3000,
      })
      .trim();

    // Path_helper outputs: PATH="..."; export PATH;
    const match = output.match(/PATH="([^"]+)"/);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // Path_helper not available or failed.
  }

  return null;
}

function readEnvironmentFromShell(shell: string, args: string[]): Record<string, string> | null {
  try {
    const output = fixPathRuntime.execFileSync(shell, args, {
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });

    return extractEnvironment(Buffer.isBuffer(output) ? output : Buffer.from(output));
  } catch {
    // Shell failed (timeout, unsupported flags, etc.) — fall through.
    return null;
  }
}

function extractEnvironment(output: Buffer): Record<string, string> | null {
  const startIndex = output.lastIndexOf(SHELL_ENV_SENTINEL_START);
  if (startIndex !== -1) {
    const payloadStart = startIndex + SHELL_ENV_SENTINEL_START.length;
    const endIndex = output.indexOf(SHELL_ENV_SENTINEL_END, payloadStart);
    if (endIndex !== -1) {
      const environment = parseEnvironmentPayload(output.subarray(payloadStart, endIndex));
      if (Object.keys(environment).length > 0) {
        return environment;
      }
    }
  }

  return null;
}

function mergePaths(resolvedPath: string | null, currentPath: string | undefined): string | null {
  const segments = [resolvedPath, currentPath]
    .flatMap((value) => (value ? [value] : []))
    .flatMap((value) => value.split(":"))
    .map((value) => value.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  return [...new Set(segments)].join(":");
}

function parseEnvironmentPayload(payload: Buffer): Record<string, string> {
  const environment: Record<string, string> = {};

  for (const entry of payload.toString("utf8").split("\0")) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex > 0) {
      const key = entry.slice(0, separatorIndex).trim();
      if (key) {
        environment[key] = entry.slice(separatorIndex + 1);
      }
    }
  }

  return environment;
}

function applyShellEnvironment(shellEnvironment: Record<string, string>): void {
  const mergedPath = mergePaths(shellEnvironment.PATH ?? null, process.env.PATH);
  if (mergedPath) {
    process.env.PATH = mergedPath;
  }

  for (const [key, value] of Object.entries(shellEnvironment)) {
    const shouldSkip =
      key === "PATH" || SHELL_ENV_KEYS_TO_SKIP.has(key) || process.env[key] !== undefined;
    if (!shouldSkip) {
      process.env[key] = value;
    }
  }
}
