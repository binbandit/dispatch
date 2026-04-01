import { describe, expect, it } from "vitest";

import { getAiProviderModelOptions, resolveAiSlotModelValue } from "./ai-provider-settings";

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
});
