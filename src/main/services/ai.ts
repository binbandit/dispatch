import type { AiModelSlot, AiProvider, AiProviderStatus, AiTaskId } from "../../shared/ipc";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { constants as osConstants, setPriority, tmpdir } from "node:os";
import { basename, join } from "node:path";

import * as repo from "../db/repository";
import {
  getAiProviderConfigWithSecrets,
  getAiProviderStatusConfig,
  getAiSlotConfigWithSecrets,
  getAiTaskConfigWithSecrets,
} from "./ai-config";
import { cacheOllamaSuggestedModels, parseOllamaTagsOutput } from "./ollama-models";
import { refreshOpencodeModelsCache } from "./opencode-models";
import { execFile, resolveExecutablePath, whichVersion } from "./shell";

interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface AiCompletionArgs {
  cwd?: string;
  task?: AiTaskId;
  slot?: AiModelSlot;
  provider?: AiProvider;
  model?: string;
  binaryPath?: string;
  homePath?: string;
  baseUrl?: string;
  messages: AiMessage[];
  maxTokens?: number;
}

type AiProviderTestArgs = Omit<AiCompletionArgs, "messages" | "maxTokens"> & {
  provider: AiProvider;
};

interface ResolvedAiCompletionArgs {
  cwd: string;
  provider: AiProvider;
  model: string;
  binaryPath: string | null;
  homePath: string | null;
  baseUrl: string | null;
  messages: AiMessage[];
  maxTokens?: number;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const AI_COMPLETION_TIMEOUT_MS = 180_000;
const PROVIDER_STATUS_TIMEOUT_MS = 5000;
const COPILOT_READ_ONLY_TOOLS = "view,grep,glob";

interface ResolvedCommandSpec {
  command: string;
  argsPrefix: string[];
  usesGhWrapper: boolean;
}

function deprioritizeChildProcess(pid: number | undefined): void {
  if (!pid) {
    return;
  }

  try {
    setPriority(pid, osConstants.priority.PRIORITY_LOW);
  } catch {
    // Ignore platform and permission failures. Priority tuning is best-effort.
  }
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/u, "");
}

function normalizePathname(pathname: string): string {
  const normalizedPathname = trimTrailingSlashes(pathname);
  return normalizedPathname.length > 0 ? normalizedPathname : "/";
}

export function resolveOllamaEndpointUrl(baseUrl?: string): string {
  const rawBaseUrl = baseUrl?.trim().length ? baseUrl.trim() : "http://localhost:11434";
  const normalizedBaseUrl = /^[a-z][a-z\d+.-]*:\/\//iu.test(rawBaseUrl)
    ? rawBaseUrl
    : `http://${rawBaseUrl}`;
  const parsedBaseUrl = new URL(normalizedBaseUrl);
  const pathname = normalizePathname(parsedBaseUrl.pathname);
  const endpointPath = "/api/chat";

  if (pathname.endsWith(endpointPath) || pathname.endsWith("/chat")) {
    parsedBaseUrl.pathname = pathname;
    return parsedBaseUrl.toString();
  }

  const basePath =
    pathname === "/" ? "/api" : pathname.endsWith("/api") ? pathname : `${pathname}/api`;

  parsedBaseUrl.pathname = `${basePath}/chat`;
  return parsedBaseUrl.toString();
}

function resolveOllamaStatusUrl(baseUrl?: string): string {
  return resolveOllamaEndpointUrl(baseUrl).replace(/\/api\/chat$/u, "/api/tags");
}

export function normalizeProviderVersion(rawVersion: string | null): string | null {
  if (!rawVersion) {
    return null;
  }

  const match = rawVersion.match(/(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/u);
  return match?.[1] ?? null;
}

export function parseCodexAuthStatus(output: string): boolean {
  return /^\s*logged in\b/iu.test(output);
}

export function parseClaudeAuthStatus(output: string): boolean {
  try {
    const parsed = JSON.parse(output) as { loggedIn?: boolean };
    return !!parsed.loggedIn;
  } catch {
    return false;
  }
}

export function buildCompletionPrompt(messages: AiMessage[]): {
  systemPrompt: string | null;
  prompt: string;
} {
  const systemPrompt = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0)
    .join("\n\n");

  const conversation = messages
    .filter((message) => message.role !== "system")
    .map((message) => `${message.role.toUpperCase()}:\n${message.content.trim()}`)
    .join("\n\n");

  return {
    systemPrompt: systemPrompt.length > 0 ? systemPrompt : null,
    prompt: [
      "Continue the conversation below and reply as the assistant.",
      "Return only the assistant response.",
      "",
      conversation,
    ].join("\n"),
  };
}

export function buildProviderTestMessages(): AiMessage[] {
  return [
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
  ];
}

export function buildCodexCommandArgs(model: string, outputPath: string): string[] {
  return [
    "exec",
    "--ephemeral",
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "--model",
    model,
    "--config",
    'model_reasoning_effort="low"',
    "--color",
    "never",
    "-o",
    outputPath,
    "-",
  ];
}

export function buildClaudeCommandArgs(model: string, systemPrompt?: string | null): string[] {
  return [
    "-p",
    "--output-format",
    "text",
    "--input-format",
    "text",
    "--no-session-persistence",
    "--tools",
    "",
    "--model",
    model,
    ...(systemPrompt ? ["--system-prompt", systemPrompt] : []),
  ];
}

export function buildCopilotCommandArgs(
  model: string,
  prompt: string,
  argsPrefix: string[] = [],
): string[] {
  return [
    ...argsPrefix,
    "-p",
    prompt,
    "-s",
    "--output-format=text",
    "--no-save-session",
    "--allow-all-tools",
    "--allow-all-paths",
    "--available-tools",
    COPILOT_READ_ONLY_TOOLS,
    "--model",
    model,
  ];
}

export function buildOpencodeCommandArgs(model: string): string[] {
  return ["run", "--format", "json", "--pure", "-m", model];
}

export function parseOpencodeJsonOutput(output: string): string {
  const textParts: string[] = [];

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) {
      try {
        const event = JSON.parse(trimmed) as {
          type: string;
          part?: { type: string; text?: string };
        };
        if (event.type === "text" && event.part?.type === "text" && event.part.text) {
          textParts.push(event.part.text);
        }
      } catch {
        // Skip non-JSON lines.
      }
    }
  }

  return textParts.join("");
}

function resolveWorkingDirectory(cwd?: string): string {
  return cwd ?? repo.getActiveWorkspace()?.path ?? process.cwd();
}

function getCommandBasename(command: string): string {
  return basename(command)
    .toLowerCase()
    .replace(/\.exe$/u, "");
}

const CLI_PROVIDER_LABELS: Record<"codex" | "claude" | "opencode", string> = {
  codex: "Codex",
  claude: "Claude",
  opencode: "OpenCode",
};

function resolveConfiguredBinaryPath(
  provider: "codex" | "claude" | "opencode",
  binaryPath: string | null,
): string {
  const label = CLI_PROVIDER_LABELS[provider];

  if (!binaryPath) {
    throw new Error(`${label} CLI is not configured. Set a binary path in Settings.`);
  }

  if (binaryPath.includes("/") || binaryPath.includes("\\")) {
    return binaryPath;
  }

  const resolvedBinaryPath = resolveExecutablePath(binaryPath);
  if (resolvedBinaryPath) {
    return resolvedBinaryPath;
  }

  throw new Error(`${label} CLI (\`${binaryPath}\`) is not available on PATH.`);
}

export function resolveCopilotCommandSpec(binaryPath: string | null): ResolvedCommandSpec {
  const configuredCommand = binaryPath?.trim() || "copilot";
  const resolvedCommand =
    configuredCommand.includes("/") || configuredCommand.includes("\\")
      ? configuredCommand
      : (resolveExecutablePath(configuredCommand) ?? null);

  if (resolvedCommand) {
    return getCommandBasename(resolvedCommand) === "gh"
      ? {
          command: resolvedCommand,
          argsPrefix: ["copilot", "--"],
          usesGhWrapper: true,
        }
      : {
          command: resolvedCommand,
          argsPrefix: [],
          usesGhWrapper: false,
        };
  }

  if (configuredCommand === "copilot") {
    const ghCommand = resolveExecutablePath("gh");
    if (ghCommand) {
      return {
        command: ghCommand,
        argsPrefix: ["copilot", "--"],
        usesGhWrapper: true,
      };
    }
  }

  throw new Error(
    "GitHub Copilot CLI is not installed. Install the standalone `copilot` binary or `gh copilot`, or set a custom binary path in Settings.",
  );
}

function createCliError(
  provider: "codex" | "claude" | "copilot" | "opencode",
  detail: string,
): Error {
  const providerName =
    provider === "codex"
      ? "Codex"
      : provider === "claude"
        ? "Claude"
        : provider === "copilot"
          ? "GitHub Copilot"
          : "OpenCode";
  return new Error(`${providerName} CLI error: ${detail}`);
}

async function readCommandVersion(
  command: string,
  argsPrefix: string[] = [],
): Promise<string | null> {
  try {
    const result = await execFile(command, [...argsPrefix, "--version"], {
      timeout: PROVIDER_STATUS_TIMEOUT_MS,
    });
    return normalizeProviderVersion(`${result.stdout}\n${result.stderr}`);
  } catch {
    return null;
  }
}

function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    input: string;
    timeoutMs: number;
  },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    deprioritizeChildProcess(child.pid);

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      reject(new Error("Request timed out."));
    }, options.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: exitCode ?? 0,
      });
    });

    child.stdin.on("error", () => {
      // Ignore EPIPE when the CLI exits before fully consuming stdin.
    });
    child.stdin.end(options.input);
  });
}

async function probeCodexStatus(): Promise<AiProviderStatus> {
  const { binaryPath } = getAiProviderStatusConfig("codex");
  const command = binaryPath ?? "codex";
  const version = normalizeProviderVersion(await whichVersion(command));

  if (!version) {
    return {
      provider: "codex",
      version: null,
      available: false,
      authenticated: false,
      statusText: "Not installed",
    };
  }

  const authenticated = await execFile(command, ["login", "status"], {
    timeout: PROVIDER_STATUS_TIMEOUT_MS,
  })
    .then((result) => parseCodexAuthStatus(result.stdout))
    .catch(() => false);

  return {
    provider: "codex",
    version,
    available: true,
    authenticated,
    statusText: authenticated ? "Authenticated" : "Authentication required",
  };
}

async function probeClaudeStatus(): Promise<AiProviderStatus> {
  const { binaryPath } = getAiProviderStatusConfig("claude");
  const command = binaryPath ?? "claude";
  const version = normalizeProviderVersion(await whichVersion(command));

  if (!version) {
    return {
      provider: "claude",
      version: null,
      available: false,
      authenticated: false,
      statusText: "Not installed",
    };
  }

  const authenticated = await execFile(command, ["auth", "status"], {
    timeout: PROVIDER_STATUS_TIMEOUT_MS,
  })
    .then((result) => parseClaudeAuthStatus(result.stdout))
    .catch(() => false);

  return {
    provider: "claude",
    version,
    available: true,
    authenticated,
    statusText: authenticated ? "Authenticated" : "Authentication required",
  };
}

async function probeCopilotStatus(): Promise<AiProviderStatus> {
  const { binaryPath } = getAiProviderStatusConfig("copilot");

  let commandSpec: ResolvedCommandSpec | null = null;
  try {
    commandSpec = resolveCopilotCommandSpec(binaryPath);
  } catch {
    return {
      provider: "copilot",
      version: null,
      available: false,
      authenticated: false,
      statusText: "Not installed",
    };
  }

  const version = await readCommandVersion(commandSpec.command, commandSpec.argsPrefix);

  if (!version) {
    return {
      provider: "copilot",
      version: null,
      available: false,
      authenticated: false,
      statusText: "Not installed",
    };
  }

  if (!commandSpec.usesGhWrapper) {
    return {
      provider: "copilot",
      version,
      available: true,
      authenticated: null,
      statusText: "Installed, authentication not verified",
    };
  }

  const authenticated = await execFile(commandSpec.command, ["auth", "status"], {
    timeout: PROVIDER_STATUS_TIMEOUT_MS,
  })
    .then(() => true)
    .catch(() => false);

  return {
    provider: "copilot",
    version,
    available: true,
    authenticated,
    statusText: authenticated ? "Authenticated via GitHub CLI" : "GitHub CLI auth required",
  };
}

async function probeOllamaStatus(): Promise<AiProviderStatus> {
  const { baseUrl } = getAiProviderStatusConfig("ollama");
  const version = normalizeProviderVersion(await whichVersion("ollama"));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_STATUS_TIMEOUT_MS);

  try {
    const response = await fetch(resolveOllamaStatusUrl(baseUrl ?? undefined), {
      method: "GET",
      signal: controller.signal,
    });

    if (response.ok) {
      cacheOllamaSuggestedModels(parseOllamaTagsOutput(await response.text()));
    } else {
      cacheOllamaSuggestedModels([]);
    }

    return {
      provider: "ollama",
      version,
      available: response.ok,
      authenticated: null,
      statusText: response.ok ? "Local runtime ready" : "Local runtime unavailable",
    };
  } catch {
    cacheOllamaSuggestedModels([]);
    return {
      provider: "ollama",
      version,
      available: false,
      authenticated: null,
      statusText: version ? "Installed, daemon unavailable" : "Not installed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeOpencodeStatus(): Promise<AiProviderStatus> {
  const { binaryPath } = getAiProviderStatusConfig("opencode");
  const command = binaryPath ?? "opencode";
  const version = normalizeProviderVersion(await whichVersion(command));

  if (!version) {
    return {
      provider: "opencode",
      version: null,
      available: false,
      authenticated: false,
      statusText: "Not installed",
    };
  }

  // Refresh the available-models cache while we know the binary is reachable.
  // The result is used synchronously by getAiConfig().
  await refreshOpencodeModelsCache();

  // OpenCode doesn't have a dedicated auth status command; if the binary
  // Exists we report it as available. Authentication is handled per-provider
  // Inside OpenCode's own config.
  return {
    provider: "opencode",
    version,
    available: true,
    authenticated: null,
    statusText: "Installed",
  };
}

export function getProvidersStatus(): Promise<AiProviderStatus[]> {
  return Promise.all([
    probeCodexStatus(),
    probeClaudeStatus(),
    probeCopilotStatus(),
    probeOllamaStatus(),
    probeOpencodeStatus(),
  ]);
}

export async function testProvider(args: AiProviderTestArgs): Promise<string> {
  const responseText = await complete({
    ...args,
    messages: buildProviderTestMessages(),
    maxTokens: 64,
  });
  const response = responseText.trim();

  if (response.length === 0) {
    throw new Error("Provider returned an empty response.");
  }

  return response;
}

export function complete(args: AiCompletionArgs): Promise<string> {
  const config = args.provider
    ? getAiProviderConfigWithSecrets(args.provider, {
        model: args.model,
        binaryPath: args.binaryPath,
        homePath: args.homePath,
        baseUrl: args.baseUrl,
      })
    : args.task
      ? getAiTaskConfigWithSecrets(args.task)
      : args.slot
        ? getAiSlotConfigWithSecrets(args.slot)
        : null;

  if (!config) {
    throw new Error("AI request is missing a provider, model slot, or task.");
  }

  if (!config.provider) {
    throw new Error(
      "AI provider is not configured for this task. Update the AI model slots in Settings.",
    );
  }

  if (!config.model) {
    throw new Error(`AI model is not configured for ${config.provider}.`);
  }

  const request: ResolvedAiCompletionArgs = {
    ...args,
    provider: config.provider,
    model: config.model,
    binaryPath: config.binaryPath,
    homePath: config.homePath,
    baseUrl: config.baseUrl,
    cwd: resolveWorkingDirectory(args.cwd),
  };

  switch (request.provider) {
    case "codex": {
      return completeWithCodex(request);
    }
    case "claude": {
      return completeWithClaude(request);
    }
    case "copilot": {
      return completeWithCopilot(request);
    }
    case "ollama": {
      return completeWithOllama(request);
    }
    case "opencode": {
      return completeWithOpencode(request);
    }
  }
}

async function completeWithCodex(args: ResolvedAiCompletionArgs): Promise<string> {
  const binaryPath = resolveConfiguredBinaryPath("codex", args.binaryPath);
  const { systemPrompt, prompt } = buildCompletionPrompt(args.messages);
  const input = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
  const tempDir = await mkdtemp(join(tmpdir(), "dispatch-codex-"));
  const outputPath = join(tempDir, "response.txt");

  try {
    const result = await runProcess(binaryPath, buildCodexCommandArgs(args.model, outputPath), {
      cwd: args.cwd,
      env: {
        ...process.env,
        ...(args.homePath ? { CODEX_HOME: args.homePath } : {}),
      },
      input,
      timeoutMs: AI_COMPLETION_TIMEOUT_MS,
    });

    if (result.exitCode !== 0) {
      const detail = result.stderr.length > 0 ? result.stderr : result.stdout;
      throw createCliError(
        "codex",
        detail.length > 0 ? detail : `Command failed with code ${result.exitCode}.`,
      );
    }

    try {
      const outputText = await readFile(outputPath, "utf8");
      const content = outputText.trim();
      if (content.length > 0) {
        return content;
      }
    } catch {
      // Fall through to stdout.
    }

    return result.stdout;
  } catch (error) {
    if (error instanceof Error && !error.message.startsWith("Codex CLI error:")) {
      throw createCliError("codex", error.message);
    }
    throw error;
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

async function completeWithClaude(args: ResolvedAiCompletionArgs): Promise<string> {
  const binaryPath = resolveConfiguredBinaryPath("claude", args.binaryPath);
  const { systemPrompt, prompt } = buildCompletionPrompt(args.messages);

  try {
    const result = await runProcess(binaryPath, buildClaudeCommandArgs(args.model, systemPrompt), {
      cwd: args.cwd,
      env: process.env,
      input: prompt,
      timeoutMs: AI_COMPLETION_TIMEOUT_MS,
    });

    if (result.exitCode !== 0) {
      const detail = result.stderr.length > 0 ? result.stderr : result.stdout;
      throw createCliError(
        "claude",
        detail.length > 0 ? detail : `Command failed with code ${result.exitCode}.`,
      );
    }

    return result.stdout;
  } catch (error) {
    if (error instanceof Error && !error.message.startsWith("Claude CLI error:")) {
      throw createCliError("claude", error.message);
    }
    throw error;
  }
}

async function completeWithCopilot(args: ResolvedAiCompletionArgs): Promise<string> {
  const commandSpec = resolveCopilotCommandSpec(args.binaryPath);
  const { systemPrompt, prompt } = buildCompletionPrompt(args.messages);
  const input = systemPrompt ? `System instructions:\n${systemPrompt}\n\n${prompt}` : prompt;

  try {
    const result = await runProcess(
      commandSpec.command,
      buildCopilotCommandArgs(args.model, input, commandSpec.argsPrefix),
      {
        cwd: args.cwd,
        env: process.env,
        input: "",
        timeoutMs: AI_COMPLETION_TIMEOUT_MS,
      },
    );

    if (result.exitCode !== 0) {
      const detail = result.stderr.length > 0 ? result.stderr : result.stdout;
      throw createCliError(
        "copilot",
        detail.length > 0 ? detail : `Command failed with code ${result.exitCode}.`,
      );
    }

    return result.stdout;
  } catch (error) {
    if (error instanceof Error && !error.message.startsWith("GitHub Copilot CLI error:")) {
      throw createCliError("copilot", error.message);
    }
    throw error;
  }
}

async function completeWithOllama(args: ResolvedAiCompletionArgs): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_COMPLETION_TIMEOUT_MS);

  try {
    const response = await fetch(resolveOllamaEndpointUrl(args.baseUrl ?? undefined), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: args.model,
        messages: args.messages,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama API error: ${response.status} ${text}`);
    }

    const data = (await response.json()) as {
      message: { content: string };
    };
    return data.message.content ?? "";
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Ollama request timed out.", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function completeWithOpencode(args: ResolvedAiCompletionArgs): Promise<string> {
  const binaryPath = resolveConfiguredBinaryPath("opencode", args.binaryPath);
  const { systemPrompt, prompt } = buildCompletionPrompt(args.messages);
  const input = systemPrompt ? `System instructions:\n${systemPrompt}\n\n${prompt}` : prompt;

  try {
    const result = await runProcess(binaryPath, buildOpencodeCommandArgs(args.model), {
      cwd: args.cwd,
      env: process.env,
      input,
      timeoutMs: AI_COMPLETION_TIMEOUT_MS,
    });

    if (result.exitCode !== 0) {
      const detail = result.stderr.length > 0 ? result.stderr : result.stdout;
      throw createCliError(
        "opencode",
        detail.length > 0 ? detail : `Command failed with code ${result.exitCode}.`,
      );
    }

    const parsed = parseOpencodeJsonOutput(result.stdout);
    if (parsed.length > 0) {
      return parsed;
    }

    return result.stdout;
  } catch (error) {
    if (error instanceof Error && !error.message.startsWith("OpenCode CLI error:")) {
      throw createCliError("opencode", error.message);
    }
    throw error;
  }
}
