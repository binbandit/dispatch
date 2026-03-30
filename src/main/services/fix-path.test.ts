import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fixPath, fixPathRuntime } from "./fix-path";

const originalPath = process.env.PATH;
const originalShell = process.env.SHELL;
const originalPlatform = process.platform;

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
    setPlatform("darwin");
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    process.env.SHELL = originalShell;
    setPlatform(originalPlatform);
    vi.restoreAllMocks();
  });

  it("uses the interactive login shell PATH and preserves existing entries", () => {
    const execFileSyncMock = vi
      .spyOn(fixPathRuntime, "execFileSync")
      .mockReturnValueOnce(
        `startup noise\n__DISPATCH_PATH_START__/opt/homebrew/bin:/usr/local/bin:/usr/bin__DISPATCH_PATH_END__`,
      );

    fixPath();

    expect(execFileSyncMock).toHaveBeenCalledWith(
      "/bin/zsh",
      [
        "-i",
        "-l",
        "-c",
        "printf '__DISPATCH_PATH_START__'; printenv PATH; printf '__DISPATCH_PATH_END__'",
      ],
      expect.objectContaining({
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5_000,
      }),
    );
    expect(process.env.PATH).toBe("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
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
        timeout: 3_000,
      }),
    );
    expect(process.env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin");
  });
});
