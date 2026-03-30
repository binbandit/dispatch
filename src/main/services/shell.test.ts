import { afterEach, describe, expect, it, vi } from "vitest";

import { execFile, resetExecutableCache, shellRuntime, whichVersion } from "./shell";

type ExecFileOptions = {
  cwd?: string;
  env: NodeJS.ProcessEnv;
  maxBuffer: number;
  timeout: number;
};

const originalPath = process.env.PATH;

describe("shell exec fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetExecutableCache();
    process.env.PATH = originalPath;
  });

  it("prefers a common absolute gh install path over PATH lookup", async () => {
    const accessSyncMock = vi.spyOn(shellRuntime, "accessSync").mockImplementation((candidate) => {
      if (candidate !== "/opt/homebrew/bin/gh") {
        throw new Error("not executable");
      }
    });
    const execFileMock = vi
      .spyOn(shellRuntime, "execFile")
      .mockResolvedValueOnce({ stderr: "", stdout: "gh version 2.70.0" });

    await expect(whichVersion("gh")).resolves.toBe("gh version 2.70.0");

    expect(accessSyncMock).toHaveBeenCalledWith("/opt/homebrew/bin/gh", 1);
    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      "/opt/homebrew/bin/gh",
      ["--version"],
      expect.objectContaining<ExecFileOptions>({
        timeout: 5_000,
      }),
    );
  });

  it("prefers real binaries over shim directories from PATH", async () => {
    process.env.PATH =
      "/Users/test/.local/share/mise/shims:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";

    vi.spyOn(shellRuntime, "accessSync").mockImplementation((candidate) => {
      if (candidate === "/opt/homebrew/bin/git") {
        return;
      }

      if (candidate === "/Users/test/.local/share/mise/shims/git") {
        return;
      }

      throw new Error("not executable");
    });

    const execFileMock = vi
      .spyOn(shellRuntime, "execFile")
      .mockResolvedValueOnce({ stderr: "", stdout: "git version 2.39.0" });

    await expect(whichVersion("git")).resolves.toBe("git version 2.39.0");

    expect(execFileMock).toHaveBeenCalledWith(
      "/opt/homebrew/bin/git",
      ["--version"],
      expect.objectContaining<ExecFileOptions>({
        timeout: 5_000,
      }),
    );
  });

  it("caches the resolved executable path for later calls", async () => {
    vi.spyOn(shellRuntime, "accessSync").mockImplementation((candidate) => {
      if (candidate !== "/opt/homebrew/bin/git") {
        throw new Error("not executable");
      }
    });

    const execFileMock = vi
      .spyOn(shellRuntime, "execFile")
      .mockResolvedValueOnce({ stderr: "", stdout: "git version 2.39.0" })
      .mockResolvedValueOnce({ stderr: "", stdout: "main" });

    await expect(whichVersion("git")).resolves.toBe("git version 2.39.0");
    await expect(execFile("git", ["branch", "--show-current"])).resolves.toEqual({
      stderr: "",
      stdout: "main",
    });

    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      "/opt/homebrew/bin/git",
      ["branch", "--show-current"],
      expect.objectContaining<ExecFileOptions>({
        timeout: 30_000,
      }),
    );
  });

  it("falls back to the bare command when the preferred absolute binary cannot execute", async () => {
    vi.spyOn(shellRuntime, "accessSync").mockImplementation((candidate) => {
      if (candidate !== "/opt/homebrew/bin/git") {
        throw new Error("not executable");
      }
    });

    const execFileMock = vi
      .spyOn(shellRuntime, "execFile")
      .mockImplementationOnce(async () => {
        const error = new Error("spawn /opt/homebrew/bin/git EPERM") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      })
      .mockResolvedValueOnce({ stderr: "", stdout: "git version 2.39.0" });

    await expect(whichVersion("git")).resolves.toBe("git version 2.39.0");
    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      "/opt/homebrew/bin/git",
      ["--version"],
      expect.objectContaining<ExecFileOptions>({
        timeout: 5_000,
      }),
    );
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      "git",
      ["--version"],
      expect.objectContaining<ExecFileOptions>({
        timeout: 5_000,
      }),
    );
  });
});
