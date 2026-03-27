import { describe, expect, it } from "vitest";

import { resolveAiConfigFromSources } from "./ai-config";

describe("resolveAiConfigFromSources", () => {
  it("infers an OpenAI configuration from environment variables", () => {
    const config = resolveAiConfigFromSources(
      {
        aiProvider: null,
        aiModel: null,
        aiApiKey: null,
        aiBaseUrl: null,
      },
      {
        OPENAI_API_KEY: "sk-env",
        OPENAI_MODEL: "gpt-5-mini",
      },
    );

    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-5-mini");
    expect(config.apiKey).toBe("sk-env");
    expect(config.isConfigured).toBeTruthy();
    expect(config.providerSource).toBe("environment");
    expect(config.providerEnvVar).toBe("OPENAI_API_KEY");
    expect(config.modelEnvVar).toBe("OPENAI_MODEL");
    expect(config.apiKeyEnvVar).toBe("OPENAI_API_KEY");
  });

  it("lets saved preferences override environment values", () => {
    const config = resolveAiConfigFromSources(
      {
        aiProvider: "anthropic",
        aiModel: "claude-custom",
        aiApiKey: "pref-key",
        aiBaseUrl: "https://anthropic.example.test",
      },
      {
        OPENAI_API_KEY: "sk-env",
        OPENAI_MODEL: "gpt-5-mini",
      },
    );

    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("claude-custom");
    expect(config.apiKey).toBe("pref-key");
    expect(config.baseUrl).toBe("https://anthropic.example.test");
    expect(config.providerSource).toBe("preference");
    expect(config.modelSource).toBe("preference");
    expect(config.apiKeySource).toBe("preference");
    expect(config.baseUrlSource).toBe("preference");
  });

  it("treats a saved provider of none as an explicit disable", () => {
    const config = resolveAiConfigFromSources(
      {
        aiProvider: "none",
        aiModel: null,
        aiApiKey: null,
        aiBaseUrl: null,
      },
      {
        OPENAI_API_KEY: "sk-env",
      },
    );

    expect(config.provider).toBeNull();
    expect(config.isConfigured).toBeFalsy();
    expect(config.providerSource).toBe("preference");
  });

  it("does not infer a provider when multiple provider environments are present", () => {
    const config = resolveAiConfigFromSources(
      {
        aiProvider: null,
        aiModel: null,
        aiApiKey: null,
        aiBaseUrl: null,
      },
      {
        OPENAI_API_KEY: "sk-openai",
        ANTHROPIC_API_KEY: "sk-anthropic",
      },
    );

    expect(config.provider).toBeNull();
    expect(config.isConfigured).toBeFalsy();
    expect(config.providerSource).toBe("none");
  });

  it("treats Ollama as configured without an API key", () => {
    const config = resolveAiConfigFromSources(
      {
        aiProvider: null,
        aiModel: null,
        aiApiKey: null,
        aiBaseUrl: null,
      },
      {
        OLLAMA_HOST: "http://localhost:11434",
      },
    );

    expect(config.provider).toBe("ollama");
    expect(config.model).toBe("llama3.1");
    expect(config.baseUrl).toBe("http://localhost:11434");
    expect(config.apiKey).toBe("");
    expect(config.hasApiKey).toBeFalsy();
    expect(config.isConfigured).toBeTruthy();
  });
});
