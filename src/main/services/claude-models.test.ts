import { describe, expect, it } from "vitest";

import { resolveClaudeSuggestedModels } from "./claude-models";

describe("resolveClaudeSuggestedModels", () => {
  it("prefers the settings allowlist when Claude exposes available models", () => {
    expect(
      resolveClaudeSuggestedModels(
        {
          ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-custom",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-custom",
        },
        {
          settingsContent: JSON.stringify({
            model: "claude-opus-custom",
            availableModels: ["claude-opus-custom", "claude-sonnet-custom"],
          }),
        },
      ),
    ).toEqual(["claude-opus-custom", "claude-sonnet-custom"]);
  });

  it("treats an empty available-model list as default-only access", () => {
    expect(
      resolveClaudeSuggestedModels(
        {},
        {
          settingsContent: JSON.stringify({
            availableModels: [],
          }),
        },
      ),
    ).toEqual(["default"]);
  });

  it("falls back to custom env overrides when the settings file does not define an allowlist", () => {
    expect(
      resolveClaudeSuggestedModels(
        {
          ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-custom",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-custom",
        },
        {
          settingsContent: JSON.stringify({
            model: "claude-opus-custom",
          }),
        },
      ),
    ).toEqual(["claude-opus-custom", "claude-sonnet-custom", "claude-haiku-custom"]);
  });

  it("ignores malformed settings content", () => {
    expect(
      resolveClaudeSuggestedModels(
        {
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-custom",
        },
        {
          settingsContent: "{not-json",
        },
      ),
    ).toEqual(["claude-haiku-custom"]);
  });
});
