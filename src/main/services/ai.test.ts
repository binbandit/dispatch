/* eslint-disable import/first -- Vitest mocks must be registered before the module under test is imported. */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(import("./shell"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveExecutablePath: vi.fn(actual.resolveExecutablePath),
  };
});

import {
  buildClaudeCommandArgs,
  buildCopilotCommandArgs,
  buildCodexCommandArgs,
  buildCompletionPrompt,
  buildOpencodeCommandArgs,
  buildProviderTestMessages,
  normalizeProviderVersion,
  parseClaudeAuthStatus,
  parseCodexAuthStatus,
  parseOpencodeJsonOutput,
  resolveCopilotCommandSpec,
  resolveOllamaEndpointUrl,
} from "./ai";
import { resolveExecutablePath } from "./shell";

const resolveExecutablePathMock = vi.mocked(resolveExecutablePath);

afterEach(() => {
  vi.resetAllMocks();
});

describe("buildCompletionPrompt", () => {
  it("separates system instructions from the conversation prompt", () => {
    expect(
      buildCompletionPrompt([
        { role: "system", content: "Be concise." },
        { role: "user", content: "Explain this diff." },
        { role: "assistant", content: "Sure." },
        { role: "user", content: "Keep it short." },
      ]),
    ).toEqual({
      systemPrompt: "Be concise.",
      prompt: [
        "Continue the conversation below and reply as the assistant.",
        "Return only the assistant response.",
        "",
        "USER:\nExplain this diff.\n\nASSISTANT:\nSure.\n\nUSER:\nKeep it short.",
      ].join("\n"),
    });
  });
});

describe("buildProviderTestMessages", () => {
  it("builds a short smoke-test exchange for provider validation", () => {
    expect(buildProviderTestMessages()).toEqual([
      {
        role: "system",
        content:
          "You are validating a local AI provider connection for Dispatch. Reply in plain text with one short sentence only. Do not use markdown.",
      },
      {
        role: "user",
        content:
          'Confirm the provider is working by replying with the exact phrase "Dispatch AI test successful".',
      },
    ]);
  });
});

describe("buildCodexCommandArgs", () => {
  it("builds a non-interactive codex exec invocation", () => {
    expect(buildCodexCommandArgs("gpt-5.4", "/tmp/dispatch-response.txt")).toEqual([
      "exec",
      "--ephemeral",
      "-s",
      "read-only",
      "--skip-git-repo-check",
      "--model",
      "gpt-5.4",
      "--config",
      'model_reasoning_effort="low"',
      "--color",
      "never",
      "-o",
      "/tmp/dispatch-response.txt",
      "-",
    ]);
  });
});

describe("buildClaudeCommandArgs", () => {
  it("builds a print-mode claude invocation with tools disabled", () => {
    expect(buildClaudeCommandArgs("claude-sonnet-4-6", "Stay brief.")).toEqual([
      "-p",
      "--output-format",
      "text",
      "--input-format",
      "text",
      "--no-session-persistence",
      "--tools",
      "",
      "--model",
      "claude-sonnet-4-6",
      "--system-prompt",
      "Stay brief.",
    ]);
  });
});

describe("buildCopilotCommandArgs", () => {
  it("builds a print-mode Copilot invocation with read-only tools", () => {
    expect(
      buildCopilotCommandArgs("gpt-5.3-codex", "Summarize this diff.", ["copilot", "--"]),
    ).toEqual([
      "copilot",
      "--",
      "-p",
      "Summarize this diff.",
      "-s",
      "--output-format=text",
      "--no-save-session",
      "--allow-all-tools",
      "--allow-all-paths",
      "--available-tools",
      "view,grep,glob",
      "--model",
      "gpt-5.3-codex",
    ]);
  });
});

describe("resolveCopilotCommandSpec", () => {
  it("uses the standalone copilot binary when available", () => {
    resolveExecutablePathMock.mockImplementation((command) =>
      command === "copilot" ? "/opt/homebrew/bin/copilot" : null,
    );

    expect(resolveCopilotCommandSpec(null)).toEqual({
      command: "/opt/homebrew/bin/copilot",
      argsPrefix: [],
      usesGhWrapper: false,
    });
  });

  it("falls back to gh copilot when the standalone binary is unavailable", () => {
    resolveExecutablePathMock.mockImplementation((command) => {
      if (command === "copilot") {
        return null;
      }
      return command === "gh" ? "/opt/homebrew/bin/gh" : null;
    });

    expect(resolveCopilotCommandSpec(null)).toEqual({
      command: "/opt/homebrew/bin/gh",
      argsPrefix: ["copilot", "--"],
      usesGhWrapper: true,
    });
  });

  it("treats a configured gh binary path as the wrapper command", () => {
    resolveExecutablePathMock.mockImplementation((command) =>
      command === "gh" ? "/usr/local/bin/gh" : null,
    );

    expect(resolveCopilotCommandSpec("gh")).toEqual({
      command: "/usr/local/bin/gh",
      argsPrefix: ["copilot", "--"],
      usesGhWrapper: true,
    });
  });
});

describe("resolveOllamaEndpointUrl", () => {
  it("normalizes Ollama origins without duplicating /api", () => {
    expect(resolveOllamaEndpointUrl("http://localhost:11434/")).toBe(
      "http://localhost:11434/api/chat",
    );
    expect(resolveOllamaEndpointUrl("http://localhost:11434/api")).toBe(
      "http://localhost:11434/api/chat",
    );
  });
});

describe("buildOpencodeCommandArgs", () => {
  it("produces the expected argument array", () => {
    expect(buildOpencodeCommandArgs("anthropic/claude-sonnet-4-20250514")).toEqual([
      "run",
      "--format",
      "json",
      "--pure",
      "-m",
      "anthropic/claude-sonnet-4-20250514",
    ]);
  });
});

describe("parseOpencodeJsonOutput", () => {
  it("extracts text from NDJSON text events", () => {
    const output = [
      '{"type":"start"}',
      '{"type":"text","part":{"type":"text","text":"Hello "}}',
      '{"type":"text","part":{"type":"text","text":"world"}}',
      '{"type":"end"}',
    ].join("\n");
    expect(parseOpencodeJsonOutput(output)).toBe("Hello world");
  });

  it("skips non-JSON lines gracefully", () => {
    const output = [
      "some debug output",
      '{"type":"text","part":{"type":"text","text":"result"}}',
      "another debug line",
    ].join("\n");
    expect(parseOpencodeJsonOutput(output)).toBe("result");
  });

  it("returns empty string for empty input", () => {
    expect(parseOpencodeJsonOutput("")).toBe("");
  });

  it("returns empty string when no text events are present", () => {
    const output = '{"type":"start"}\n{"type":"end"}';
    expect(parseOpencodeJsonOutput(output)).toBe("");
  });
});

describe("normalizeProviderVersion", () => {
  it("extracts semantic versions from CLI output", () => {
    expect(normalizeProviderVersion("codex-cli 0.117.0")).toBe("0.117.0");
    expect(normalizeProviderVersion("2.1.87 (Claude Code)")).toBe("2.1.87");
    expect(normalizeProviderVersion("ollama version is 0.18.3")).toBe("0.18.3");
  });
});

describe("provider auth parsers", () => {
  it("detects Codex login status from plain text output", () => {
    expect(parseCodexAuthStatus("Logged in using ChatGPT")).toBeTruthy();
    expect(parseCodexAuthStatus("Not logged in")).toBeFalsy();
  });

  it("detects Claude login status from JSON output", () => {
    expect(parseClaudeAuthStatus('{"loggedIn":true,"authMethod":"claude.ai"}')).toBeTruthy();
    expect(parseClaudeAuthStatus('{"loggedIn":false}')).toBeFalsy();
    expect(parseClaudeAuthStatus("not-json")).toBeFalsy();
  });
});
