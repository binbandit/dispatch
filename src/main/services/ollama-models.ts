import { normalizeValue } from "./normalize-value";

interface OllamaTagsResponse {
  models?: Array<{
    name?: unknown;
    model?: unknown;
  }>;
}

let cachedModels: string[] | null = null;

export function parseOllamaTagsOutput(output: string): string[] {
  if (output.trim().length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(output) as OllamaTagsResponse;
    if (!Array.isArray(parsed.models)) {
      return [];
    }

    const models: string[] = [];

    for (const entry of parsed.models) {
      const normalizedModel = normalizeValue(entry?.name) ?? normalizeValue(entry?.model);

      if (normalizedModel && !models.includes(normalizedModel)) {
        models.push(normalizedModel);
      }
    }

    return models;
  } catch {
    return [];
  }
}

export function cacheOllamaSuggestedModels(models: string[]): string[] {
  cachedModels = [...models];
  return cachedModels;
}

export function resolveOllamaSuggestedModels(): string[] {
  return cachedModels ?? [];
}
