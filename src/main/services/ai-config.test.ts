import { describe, expect, it } from "vitest";

import { resolveAiConfigFromSources } from "./ai-config";

function createPreferences(
  overrides: Partial<
    Record<
      | "aiProvider"
      | "aiModel"
      | "aiBinaryPath"
      | "aiHomePath"
      | "aiBaseUrl"
      | "aiCodexModel"
      | "aiCodexBinaryPath"
      | "aiCodexHomePath"
      | "aiClaudeModel"
      | "aiClaudeBinaryPath"
      | "aiCopilotModel"
      | "aiCopilotBinaryPath"
      | "aiOllamaModel"
      | "aiOllamaBaseUrl"
      | "aiBigProvider"
      | "aiBigModel"
      | "aiSmallProvider"
      | "aiSmallModel"
      | "aiTaskCodeExplanationSlot"
      | "aiTaskFailureExplanationSlot"
      | "aiTaskReviewSummarySlot"
      | "aiTaskReviewConfidenceSlot"
      | "aiTaskTriageSlot"
      | "aiTaskCommentSuggestionsSlot",
      string | null
    >
  > = {},
) {
  return {
    aiProvider: null,
    aiModel: null,
    aiBinaryPath: null,
    aiHomePath: null,
    aiBaseUrl: null,
    aiCodexModel: null,
    aiCodexBinaryPath: null,
    aiCodexHomePath: null,
    aiClaudeModel: null,
    aiClaudeBinaryPath: null,
    aiCopilotModel: null,
    aiCopilotBinaryPath: null,
    aiOllamaModel: null,
    aiOllamaBaseUrl: null,
    aiBigProvider: null,
    aiBigModel: null,
    aiSmallProvider: null,
    aiSmallModel: null,
    aiTaskCodeExplanationSlot: null,
    aiTaskFailureExplanationSlot: null,
    aiTaskReviewSummarySlot: null,
    aiTaskReviewConfidenceSlot: null,
    aiTaskTriageSlot: null,
    aiTaskCommentSuggestionsSlot: null,
    ...overrides,
  };
}

describe("resolveAiConfigFromSources", () => {
  it("infers provider connectivity from environment variables and routes tasks through slots", () => {
    const config = resolveAiConfigFromSources(createPreferences(), {
      CODEX_BINARY_PATH: "/opt/homebrew/bin/codex",
      CODEX_MODEL: "gpt-5.4-mini",
    });

    expect(config.isConfigured).toBeTruthy();
    expect(config.providers.codex.model).toBe("gpt-5.4-mini");
    expect(config.providers.codex.binaryPath).toBe("/opt/homebrew/bin/codex");
    expect(config.providers.codex.modelSource).toBe("environment");
    expect(config.slots.big.provider).toBe("codex");
    expect(config.slots.big.model).toBe("gpt-5.4-mini");
    expect(config.slots.big.providerSource).toBe("environment");
    expect(config.tasks.reviewSummary.selectedSlot).toBe("big");
    expect(config.tasks.reviewSummary.provider).toBe("codex");
    expect(config.tasks.triage.selectedSlot).toBe("small");
    expect(config.tasks.triage.provider).toBe("codex");
  });

  it("lets explicit big-slot preferences override legacy and environment settings", () => {
    const config = resolveAiConfigFromSources(
      createPreferences({
        aiBigProvider: "claude",
        aiBigModel: "opus",
        aiClaudeBinaryPath: "/custom/claude",
      }),
      {
        CODEX_BINARY_PATH: "/opt/homebrew/bin/codex",
        CODEX_MODEL: "gpt-5.4-mini",
      },
    );

    expect(config.slots.big.provider).toBe("claude");
    expect(config.slots.big.model).toBe("opus");
    expect(config.slots.big.binaryPath).toBe("/custom/claude");
    expect(config.slots.big.providerSource).toBe("preference");
    expect(config.slots.big.modelSource).toBe("preference");
    expect(config.tasks.reviewSummary.provider).toBe("claude");
  });

  it("passes detected Claude model suggestions through provider config", () => {
    const config = resolveAiConfigFromSources(
      createPreferences({
        aiBigProvider: "claude",
      }),
      {},
      {
        claudeSuggestedModels: ["claude-sonnet-custom", "claude-haiku-custom"],
      },
    );

    expect(config.providers.claude.suggestedModels).toEqual([
      "claude-sonnet-custom",
      "claude-haiku-custom",
    ]);
  });

  it("allows the small slot to use a different provider and task routing", () => {
    const config = resolveAiConfigFromSources(
      createPreferences({
        aiBigProvider: "codex",
        aiBigModel: "gpt-5.4",
        aiSmallProvider: "ollama",
        aiSmallModel: "qwen2.5-coder",
        aiOllamaBaseUrl: "http://localhost:11434",
        aiTaskTriageSlot: "big",
        aiTaskReviewSummarySlot: "small",
      }),
      {},
    );

    expect(config.slots.big.provider).toBe("codex");
    expect(config.slots.small.provider).toBe("ollama");
    expect(config.slots.small.model).toBe("qwen2.5-coder");
    expect(config.tasks.triage.selectedSlot).toBe("big");
    expect(config.tasks.triage.provider).toBe("codex");
    expect(config.tasks.reviewSummary.selectedSlot).toBe("small");
    expect(config.tasks.reviewSummary.provider).toBe("ollama");
  });

  it("treats an explicit big-slot provider of none as disabled without breaking the small slot", () => {
    const config = resolveAiConfigFromSources(
      createPreferences({
        aiBigProvider: "none",
      }),
      {
        CODEX_BINARY_PATH: "/opt/homebrew/bin/codex",
        CODEX_MODEL: "gpt-5.4-mini",
      },
    );

    expect(config.slots.big.provider).toBeNull();
    expect(config.slots.big.isConfigured).toBeFalsy();
    expect(config.slots.small.provider).toBe("codex");
    expect(config.slots.small.isConfigured).toBeTruthy();
  });

  it("does not infer a legacy provider when multiple provider environments are present", () => {
    const config = resolveAiConfigFromSources(createPreferences(), {
      CODEX_BINARY_PATH: "/opt/homebrew/bin/codex",
      CLAUDE_BINARY_PATH: "/usr/local/bin/claude",
    });

    expect(config.isConfigured).toBeFalsy();
    expect(config.slots.big.provider).toBeNull();
    expect(config.slots.small.provider).toBeNull();
  });

  it("treats Ollama as configured without a binary path", () => {
    const config = resolveAiConfigFromSources(
      createPreferences({
        aiBigProvider: "ollama",
        aiOllamaBaseUrl: "http://localhost:11434",
      }),
      {},
    );

    expect(config.providers.ollama.baseUrl).toBe("http://localhost:11434");
    expect(config.providers.ollama.binaryPath).toBeNull();
    expect(config.providers.ollama.isConfigured).toBeTruthy();
    expect(config.slots.big.provider).toBe("ollama");
    expect(config.slots.big.isConfigured).toBeTruthy();
  });

  it("reads Codex home from provider preferences", () => {
    const config = resolveAiConfigFromSources(
      createPreferences({
        aiBigProvider: "codex",
        aiCodexHomePath: "/tmp/codex-home",
      }),
      {},
    );

    expect(config.providers.codex.homePath).toBe("/tmp/codex-home");
    expect(config.providers.codex.homePathSource).toBe("preference");
    expect(config.slots.big.homePath).toBe("/tmp/codex-home");
  });

  it("falls back to legacy shared preferences for the big slot", () => {
    const config = resolveAiConfigFromSources(
      createPreferences({
        aiProvider: "copilot",
        aiModel: "gpt-5.3-codex",
        aiBinaryPath: "gh",
      }),
      {},
    );

    expect(config.slots.big.provider).toBe("copilot");
    expect(config.slots.big.model).toBe("gpt-5.3-codex");
    expect(config.slots.big.binaryPath).toBe("gh");
    expect(config.tasks.reviewSummary.provider).toBe("copilot");
  });
});
