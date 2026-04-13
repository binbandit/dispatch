import { describe, expect, it } from "vite-plus/test";

import {
  cacheOllamaSuggestedModels,
  parseOllamaTagsOutput,
  resolveOllamaSuggestedModels,
} from "./ollama-models";

describe("parseOllamaTagsOutput", () => {
  it("extracts installed model names from the tags response", () => {
    const output = JSON.stringify({
      models: [{ name: "qwen2.5-coder:14b" }, { name: "llama3.2:latest" }],
    });

    expect(parseOllamaTagsOutput(output)).toEqual(["qwen2.5-coder:14b", "llama3.2:latest"]);
  });

  it("falls back to the model field and removes duplicates", () => {
    const output = JSON.stringify({
      models: [
        { model: "deepseek-r1:8b" },
        { name: "deepseek-r1:8b" },
        { name: "  llama3.1:latest  " },
      ],
    });

    expect(parseOllamaTagsOutput(output)).toEqual(["deepseek-r1:8b", "llama3.1:latest"]);
  });

  it("returns an empty array for invalid payloads", () => {
    expect(parseOllamaTagsOutput("")).toEqual([]);
    expect(parseOllamaTagsOutput("{}")).toEqual([]);
    expect(parseOllamaTagsOutput("not-json")).toEqual([]);
  });

  it("skips entries with null/undefined names", () => {
    const output = JSON.stringify({
      models: [{ name: null }, { name: "valid:latest" }, {}],
    });
    expect(parseOllamaTagsOutput(output)).toEqual(["valid:latest"]);
  });

  it("skips empty/whitespace-only names", () => {
    const output = JSON.stringify({
      models: [{ name: "  " }, { name: "" }, { name: "real:model" }],
    });
    expect(parseOllamaTagsOutput(output)).toEqual(["real:model"]);
  });
});

describe("cacheOllamaSuggestedModels", () => {
  it("caches and returns models", () => {
    const models = ["llama3.1", "qwen2.5-coder"];
    const result = cacheOllamaSuggestedModels(models);
    expect(result).toEqual(models);
  });

  it("returns cached models via resolveOllamaSuggestedModels", () => {
    cacheOllamaSuggestedModels(["cached-model"]);
    expect(resolveOllamaSuggestedModels()).toEqual(["cached-model"]);
  });

  it("does not mutate original array", () => {
    const original = ["a", "b"];
    cacheOllamaSuggestedModels(original);
    original.push("c");
    expect(resolveOllamaSuggestedModels()).toEqual(["a", "b"]);
  });
});
