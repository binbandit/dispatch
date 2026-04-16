import { describe, expect, it } from "vite-plus/test";

import {
  getAiModelSlotPreferenceKey,
  getAiProviderModelOptions,
  getAiProviderPreferenceKey,
  getAiProviderPreferenceValue,
  getAiTaskSlotPreferenceKey,
  normalizeAiTaskSlot,
  resolveAiSlotModelValue,
} from "./ai-provider-settings";

describe("getAiProviderModelOptions", () => {
  it("injects the current model when it is not part of the preset list", () => {
    expect(getAiProviderModelOptions("copilot", "claude-sonnet-4.6")[0]).toEqual({
      label: "claude-sonnet-4.6",
      value: "claude-sonnet-4.6",
    });
  });

  it("keeps the preset list unchanged when the current model is already known", () => {
    expect(getAiProviderModelOptions("claude", "opus").at(0)).toEqual({
      label: "Default",
      value: "default",
    });
  });

  it("prefers detected model suggestions when provided", () => {
    expect(
      getAiProviderModelOptions("claude", "claude-haiku-custom", [
        "claude-sonnet-custom",
        "claude-haiku-custom",
      ]),
    ).toEqual([
      { label: "claude-sonnet-custom", value: "claude-sonnet-custom" },
      { label: "claude-haiku-custom", value: "claude-haiku-custom" },
    ]);
  });
});

describe("resolveAiSlotModelValue", () => {
  it("prefers an explicit slot model", () => {
    expect(
      resolveAiSlotModelValue("small", "codex", {
        explicitModel: "gpt-5.4-mini",
        fallbackModel: "gpt-5.4",
      }),
    ).toBe("gpt-5.4-mini");
  });

  it("falls back to the inherited provider model when present", () => {
    expect(
      resolveAiSlotModelValue("big", "claude", {
        explicitModel: null,
        fallbackModel: "opus",
      }),
    ).toBe("opus");
  });

  it("falls back to the slot default when nothing else is provided", () => {
    expect(
      resolveAiSlotModelValue("small", "claude", {
        explicitModel: null,
        fallbackModel: null,
      }),
    ).toBe("haiku");
  });

  it("skips whitespace-only explicit model", () => {
    expect(
      resolveAiSlotModelValue("small", "claude", { explicitModel: "  ", fallbackModel: "haiku" }),
    ).toBe("haiku");
  });
});

describe("getAiProviderPreferenceKey", () => {
  it("returns scoped key for codex model", () => {
    expect(getAiProviderPreferenceKey("codex", "model")).toBe("aiCodexModel");
  });

  it("returns null for providers without the field", () => {
    expect(getAiProviderPreferenceKey("ollama", "binaryPath")).toBeNull();
    expect(getAiProviderPreferenceKey("claude", "homePath")).toBeNull();
    expect(getAiProviderPreferenceKey("codex", "baseUrl")).toBeNull();
  });

  it("returns baseUrl key for ollama", () => {
    expect(getAiProviderPreferenceKey("ollama", "baseUrl")).toBe("aiOllamaBaseUrl");
  });
});

describe("getAiModelSlotPreferenceKey", () => {
  it("returns provider key for big slot", () => {
    expect(getAiModelSlotPreferenceKey("big", "provider")).toBe("aiBigProvider");
  });

  it("returns model key for small slot", () => {
    expect(getAiModelSlotPreferenceKey("small", "model")).toBe("aiSmallModel");
  });
});

describe("getAiTaskSlotPreferenceKey", () => {
  it("returns correct key for each task", () => {
    expect(getAiTaskSlotPreferenceKey("reviewSummary")).toBe("aiTaskReviewSummarySlot");
    expect(getAiTaskSlotPreferenceKey("commentRewrite")).toBe("aiTaskCommentRewriteSlot");
    expect(getAiTaskSlotPreferenceKey("triage")).toBe("aiTaskTriageSlot");
  });
});

describe("normalizeAiTaskSlot", () => {
  it('returns "big" for "big"', () => {
    expect(normalizeAiTaskSlot("big")).toBe("big");
  });

  it('returns "small" for "small"', () => {
    expect(normalizeAiTaskSlot("small")).toBe("small");
  });

  it("returns null for invalid values", () => {
    expect(normalizeAiTaskSlot("medium")).toBeNull();
    expect(normalizeAiTaskSlot("")).toBeNull();
    expect(normalizeAiTaskSlot(null)).toBeNull();
    expect(normalizeAiTaskSlot()).toBeNull();
    expect(normalizeAiTaskSlot("  ")).toBeNull();
  });
});

describe("getAiProviderPreferenceValue", () => {
  it("returns scoped value when set", () => {
    expect(
      getAiProviderPreferenceValue({ aiCodexModel: "gpt-5.4-mini" }, "codex", { field: "model" }),
    ).toBe("gpt-5.4-mini");
  });

  it("falls back to legacy key when active provider matches", () => {
    expect(
      getAiProviderPreferenceValue({ aiModel: "legacy" }, "codex", {
        field: "model",
        activeProvider: "codex",
      }),
    ).toBe("legacy");
  });

  it("does not use legacy key when active provider differs", () => {
    expect(
      getAiProviderPreferenceValue({ aiModel: "legacy" }, "codex", {
        field: "model",
        activeProvider: "claude",
      }),
    ).toBeNull();
  });

  it("returns null for empty/whitespace values", () => {
    expect(
      getAiProviderPreferenceValue({ aiCodexModel: "   " }, "codex", { field: "model" }),
    ).toBeNull();
  });

  it("prefers scoped key over legacy key", () => {
    expect(
      getAiProviderPreferenceValue({ aiCodexModel: "scoped", aiModel: "legacy" }, "codex", {
        field: "model",
        activeProvider: "codex",
      }),
    ).toBe("scoped");
  });
});
