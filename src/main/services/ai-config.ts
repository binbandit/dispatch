import type { AiConfigSource, AiProvider, AiResolvedConfig } from "../../shared/ipc";

import * as repo from "../db/repository";

type AiPreferenceKey = "aiProvider" | "aiModel" | "aiApiKey" | "aiBaseUrl";
type AiPreferences = Record<AiPreferenceKey, string | null>;
type AiResolutionSource = AiConfigSource | "argument";
type EnvMap = Record<string, string | undefined>;

interface EnvLookupResult {
  value: string | null;
  envVar: string | null;
}

interface ResolvedAiConfigInternal extends AiResolvedConfig {
  apiKey: string;
}

interface AiConfigOverrides {
  provider?: AiProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

const AI_PREFERENCE_KEYS = ["aiProvider", "aiModel", "aiApiKey", "aiBaseUrl"] as const;

const DEFAULT_MODELS: Record<AiProvider, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  ollama: "llama3.1",
};

const GENERIC_ENV_KEYS = {
  provider: ["DISPATCH_AI_PROVIDER"],
  model: ["DISPATCH_AI_MODEL"],
  apiKey: ["DISPATCH_AI_API_KEY"],
  baseUrl: ["DISPATCH_AI_BASE_URL"],
} as const;

const PROVIDER_ENV_KEYS: Record<
  AiProvider,
  {
    model: readonly string[];
    apiKey: readonly string[];
    baseUrl: readonly string[];
  }
> = {
  openai: {
    model: ["OPENAI_MODEL"],
    apiKey: ["OPENAI_API_KEY"],
    baseUrl: ["OPENAI_BASE_URL"],
  },
  anthropic: {
    model: ["ANTHROPIC_MODEL"],
    apiKey: ["ANTHROPIC_API_KEY"],
    baseUrl: ["ANTHROPIC_BASE_URL"],
  },
  ollama: {
    model: ["OLLAMA_MODEL"],
    apiKey: [],
    baseUrl: ["OLLAMA_BASE_URL", "OLLAMA_HOST"],
  },
};

function normalizeValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeProvider(value: string | null | undefined): AiProvider | "none" | null {
  const normalizedValue = normalizeValue(value);

  switch (normalizedValue) {
    case "openai":
    case "anthropic":
    case "ollama":
    case "none": {
      return normalizedValue;
    }
    default: {
      return null;
    }
  }
}

function pickEnvValue(env: EnvMap, keys: readonly string[]): EnvLookupResult {
  for (const key of keys) {
    const value = normalizeValue(env[key]);
    if (value) {
      return { value, envVar: key };
    }
  }

  return { value: null, envVar: null };
}

function readAiPreferences(): AiPreferences {
  const preferences = {} as AiPreferences;

  for (const key of AI_PREFERENCE_KEYS) {
    preferences[key] = repo.getPreference(key);
  }

  return preferences;
}

function inferProviderFromEnvironment(env: EnvMap): EnvLookupResult {
  const genericProvider = pickEnvValue(env, GENERIC_ENV_KEYS.provider);
  const normalizedGenericProvider = normalizeProvider(genericProvider.value);

  if (normalizedGenericProvider) {
    return {
      value: normalizedGenericProvider,
      envVar: genericProvider.envVar,
    };
  }

  const candidates = (
    Object.entries(PROVIDER_ENV_KEYS) as Array<[AiProvider, (typeof PROVIDER_ENV_KEYS)[AiProvider]]>
  )
    .map(([provider, keys]) => {
      const lookup = pickEnvValue(env, [...keys.apiKey, ...keys.model, ...keys.baseUrl]);
      if (!lookup.value) {
        return null;
      }

      return {
        provider,
        envVar: lookup.envVar,
      };
    })
    .filter((candidate): candidate is { provider: AiProvider; envVar: string | null } =>
      Boolean(candidate),
    );

  if (candidates.length !== 1) {
    return { value: null, envVar: null };
  }

  const candidate = candidates[0];

  return {
    value: candidate?.provider ?? null,
    envVar: candidate?.envVar ?? null,
  };
}

function resolveProvider(
  preferences: AiPreferences,
  env: EnvMap,
  overrides: AiConfigOverrides,
): {
  provider: AiProvider | null;
  source: AiResolutionSource;
  envVar: string | null;
} {
  const overrideProvider = normalizeProvider(overrides.provider);
  if (overrideProvider) {
    return {
      provider: overrideProvider === "none" ? null : overrideProvider,
      source: "argument",
      envVar: null,
    };
  }

  const preferenceProvider = normalizeProvider(preferences.aiProvider);
  if (preferenceProvider) {
    return {
      provider: preferenceProvider === "none" ? null : preferenceProvider,
      source: "preference",
      envVar: null,
    };
  }

  const envProvider = inferProviderFromEnvironment(env);
  const normalizedEnvProvider = normalizeProvider(envProvider.value);
  if (normalizedEnvProvider) {
    return {
      provider: normalizedEnvProvider === "none" ? null : normalizedEnvProvider,
      source: "environment",
      envVar: envProvider.envVar,
    };
  }

  return {
    provider: null,
    source: "none",
    envVar: null,
  };
}

function resolveProviderValue(
  preferenceValue: string | null,
  env: EnvMap,
  overrideValue: string | undefined,
  envKeys: readonly string[],
  genericEnvKeys: readonly string[],
  defaultValue?: string,
): {
  value: string | null;
  source: AiResolutionSource;
  envVar: string | null;
} {
  const normalizedOverride = normalizeValue(overrideValue);
  if (normalizedOverride) {
    return {
      value: normalizedOverride,
      source: "argument",
      envVar: null,
    };
  }

  const normalizedPreference = normalizeValue(preferenceValue);
  if (normalizedPreference) {
    return {
      value: normalizedPreference,
      source: "preference",
      envVar: null,
    };
  }

  const providerSpecificEnv = pickEnvValue(env, envKeys);
  if (providerSpecificEnv.value) {
    return {
      value: providerSpecificEnv.value,
      source: "environment",
      envVar: providerSpecificEnv.envVar,
    };
  }

  const genericEnv = pickEnvValue(env, genericEnvKeys);
  if (genericEnv.value) {
    return {
      value: genericEnv.value,
      source: "environment",
      envVar: genericEnv.envVar,
    };
  }

  if (defaultValue) {
    return {
      value: defaultValue,
      source: "default",
      envVar: null,
    };
  }

  return {
    value: null,
    source: "none",
    envVar: null,
  };
}

function toPublicConfig(config: ResolvedAiConfigInternal): AiResolvedConfig {
  return {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    isConfigured: config.isConfigured,
    hasApiKey: config.hasApiKey,
    providerSource: config.providerSource,
    modelSource: config.modelSource,
    apiKeySource: config.apiKeySource,
    baseUrlSource: config.baseUrlSource,
    providerEnvVar: config.providerEnvVar,
    modelEnvVar: config.modelEnvVar,
    apiKeyEnvVar: config.apiKeyEnvVar,
    baseUrlEnvVar: config.baseUrlEnvVar,
  };
}

function coercePublicSource(source: AiResolutionSource): AiConfigSource {
  return source === "argument" ? "preference" : source;
}

export function resolveAiConfigFromSources(
  preferences: AiPreferences,
  env: EnvMap,
  overrides: AiConfigOverrides = {},
): ResolvedAiConfigInternal {
  const providerResult = resolveProvider(preferences, env, overrides);

  if (!providerResult.provider) {
    return {
      provider: null,
      model: null,
      apiKey: "",
      baseUrl: null,
      isConfigured: false,
      hasApiKey: false,
      providerSource: coercePublicSource(providerResult.source),
      modelSource: "none",
      apiKeySource: "none",
      baseUrlSource: "none",
      providerEnvVar: providerResult.envVar,
      modelEnvVar: null,
      apiKeyEnvVar: null,
      baseUrlEnvVar: null,
    };
  }

  const { provider } = providerResult;
  const providerEnvKeys = PROVIDER_ENV_KEYS[provider];

  const modelResult = resolveProviderValue(
    preferences.aiModel,
    env,
    overrides.model,
    providerEnvKeys.model,
    GENERIC_ENV_KEYS.model,
    DEFAULT_MODELS[provider],
  );

  const apiKeyResult = resolveProviderValue(
    preferences.aiApiKey,
    env,
    overrides.apiKey,
    providerEnvKeys.apiKey,
    GENERIC_ENV_KEYS.apiKey,
    provider === "ollama" ? "" : undefined,
  );

  const baseUrlResult = resolveProviderValue(
    preferences.aiBaseUrl,
    env,
    overrides.baseUrl,
    providerEnvKeys.baseUrl,
    GENERIC_ENV_KEYS.baseUrl,
  );

  const hasApiKey = apiKeyResult.value !== null && apiKeyResult.value.length > 0;
  const isConfigured = modelResult.value !== null && (provider === "ollama" || hasApiKey);

  return {
    provider,
    model: modelResult.value,
    apiKey: apiKeyResult.value ?? "",
    baseUrl: baseUrlResult.value,
    isConfigured,
    hasApiKey,
    providerSource: coercePublicSource(providerResult.source),
    modelSource: coercePublicSource(modelResult.source),
    apiKeySource: coercePublicSource(apiKeyResult.source),
    baseUrlSource: coercePublicSource(baseUrlResult.source),
    providerEnvVar: providerResult.envVar,
    modelEnvVar: modelResult.envVar,
    apiKeyEnvVar: apiKeyResult.envVar,
    baseUrlEnvVar: baseUrlResult.envVar,
  };
}

export function getAiConfig(): AiResolvedConfig {
  return toPublicConfig(resolveAiConfigFromSources(readAiPreferences(), process.env));
}

export function getAiConfigWithSecrets(
  overrides: AiConfigOverrides = {},
): ResolvedAiConfigInternal {
  return resolveAiConfigFromSources(readAiPreferences(), process.env, overrides);
}
