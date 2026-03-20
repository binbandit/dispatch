import { describe, expect, it } from "vitest";

import { resolveProviderEndpointUrl } from "./ai";

describe("resolveProviderEndpointUrl", () => {
  it("uses the default OpenAI endpoint when no base URL is configured", () => {
    expect(resolveProviderEndpointUrl("openai")).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("appends the OpenAI versioned path for a bare custom origin", () => {
    expect(resolveProviderEndpointUrl("openai", "https://gateway.example.test")).toBe(
      "https://gateway.example.test/v1/chat/completions",
    );
  });

  it("preserves nested custom OpenAI deployment paths", () => {
    expect(resolveProviderEndpointUrl("openai", "https://gateway.example.test/openai/v1/")).toBe(
      "https://gateway.example.test/openai/v1/chat/completions",
    );
  });

  it("accepts a fully-qualified OpenAI-compatible endpoint", () => {
    expect(
      resolveProviderEndpointUrl(
        "openai",
        "https://gateway.example.test/openai/v1/chat/completions",
      ),
    ).toBe("https://gateway.example.test/openai/v1/chat/completions");
  });

  it("normalizes the default Anthropic endpoint", () => {
    expect(resolveProviderEndpointUrl("anthropic")).toBe("https://api.anthropic.com/v1/messages");
  });

  it("normalizes Ollama origins without duplicating /api", () => {
    expect(resolveProviderEndpointUrl("ollama", "http://localhost:11434/")).toBe(
      "http://localhost:11434/api/chat",
    );
    expect(resolveProviderEndpointUrl("ollama", "http://localhost:11434/api")).toBe(
      "http://localhost:11434/api/chat",
    );
  });
});
