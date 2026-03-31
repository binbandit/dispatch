import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fixPath, fixPathRuntime } from "./fix-path";

const originalPath = process.env.PATH;
const originalShell = process.env.SHELL;
const originalPlatform = process.platform;
const originalMiseDataDir = process.env.MISE_DATA_DIR;
const originalPwd = process.env.PWD;
const originalViteDevServerUrl = process.env.VITE_DEV_SERVER_URL;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });
}

describe("fixPath", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.SHELL = "/bin/zsh";
    process.env.PATH = "/usr/bin:/bin";
    delete process.env.MISE_DATA_DIR;
    process.env.VITE_DEV_SERVER_URL = "http://localhost:5173";
    setPlatform("darwin");
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    process.env.SHELL = originalShell;
    process.env.MISE_DATA_DIR = originalMiseDataDir;
    process.env.PWD = originalPwd;
    process.env.VITE_DEV_SERVER_URL = originalViteDevServerUrl;
    setPlatform(originalPlatform);
    vi.restoreAllMocks();
  });

  it("imports the login shell environment and preserves existing app variables", () => {
    const execFileSyncMock = vi
      .spyOn(fixPathRuntime, "execFileSync")
      .mockReturnValueOnce(
        Buffer.from(
          `startup noise\n__DISPATCH_ENV_START__PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin\0MISE_DATA_DIR=/Users/test/.local/share/mise\0PWD=/tmp/dispatch\0__DISPATCH_ENV_END__`,
        ),
      );

    fixPath();

    expect(execFileSyncMock).toHaveBeenCalledWith(
      "/bin/zsh",
      ["-i", "-l", "-c", "printf '__DISPATCH_ENV_START__'; env -0; printf '__DISPATCH_ENV_END__'"],
      expect.objectContaining({
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }),
    );
    expect(process.env.PATH).toBe("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
    expect(process.env.MISE_DATA_DIR).toBe("/Users/test/.local/share/mise");
    expect(process.env.PWD).toBe(originalPwd);
    expect(process.env.VITE_DEV_SERVER_URL).toBe("http://localhost:5173");
  });

  it("falls back to path_helper when shell resolution fails", () => {
    const execFileSyncMock = vi
      .spyOn(fixPathRuntime, "execFileSync")
      .mockImplementationOnce(() => {
        throw new Error("interactive shell failed");
      })
      .mockImplementationOnce(() => {
        throw new Error("login shell failed");
      })
      .mockReturnValueOnce('PATH="/opt/homebrew/bin:/usr/bin:/bin"; export PATH;');

    fixPath();

    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      3,
      "/usr/libexec/path_helper",
      ["-s"],
      expect.objectContaining({
        encoding: "utf8",
        timeout: 3000,
      }),
    );
    expect(process.env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin");
  });
});
