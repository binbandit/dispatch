import type {
  AiConfigSource,
  AiModelSlot,
  AiProvider,
  AiProviderResolvedConfig,
  AiResolvedConfig,
  AiSlotResolvedConfig,
  AiTaskId,
  AiTaskResolvedConfig,
} from "../../shared/ipc";

import {
  AI_MODEL_SLOT_SCOPED_PREFERENCE_KEYS,
  AI_TASK_SLOT_SCOPED_PREFERENCE_KEYS,
  AI_PROVIDER_SCOPED_PREFERENCE_KEYS,
  DEFAULT_AI_BASE_URL_BY_PROVIDER,
  DEFAULT_AI_BINARY_PATH_BY_PROVIDER,
  DEFAULT_AI_MODEL_BY_PROVIDER,
  DEFAULT_AI_MODEL_BY_SLOT_AND_PROVIDER,
  DEFAULT_AI_TASK_SLOT,
  LEGACY_AI_PREFERENCE_KEYS,
  getAiModelSlotPreferenceKey,
  getAiProviderPreferenceValue,
  getAiTaskSlotPreferenceKey,
  normalizeAiTaskSlot,
} from "../../shared/ai-provider-settings";
import * as repo from "../db/repository";

const AI_PREFERENCE_KEYS = [
  LEGACY_AI_PREFERENCE_KEYS.provider,
  LEGACY_AI_PREFERENCE_KEYS.model,
  LEGACY_AI_PREFERENCE_KEYS.binaryPath,
  LEGACY_AI_PREFERENCE_KEYS.homePath,
  LEGACY_AI_PREFERENCE_KEYS.baseUrl,
  ...AI_PROVIDER_SCOPED_PREFERENCE_KEYS,
  ...AI_MODEL_SLOT_SCOPED_PREFERENCE_KEYS,
  ...AI_TASK_SLOT_SCOPED_PREFERENCE_KEYS,
] as const;

type AiPreferenceKey = (typeof AI_PREFERENCE_KEYS)[number];
type AiPreferences = Record<AiPreferenceKey, string | null>;
type AiResolutionSource = AiConfigSource | "argument";
type EnvMap = Record<string, string | undefined>;
interface ProviderEnvKeys {
  model: readonly string[];
  binaryPath: readonly string[];
  homePath: readonly string[];
  baseUrl: readonly string[];
}

interface EnvLookupResult {
  value: string | null;
  envVar: string | null;
}

interface ResolvedProviderSelection {
  provider: AiProvider | null;
  source: AiResolutionSource;
  envVar: string | null;
}

interface ResolvedValue {
  value: string | null;
  source: AiResolutionSource;
  envVar: string | null;
}

interface ResolveProviderValueOptions {
  preferenceValue: string | null;
  env: EnvMap;
  overrideValue?: string;
  envKeys: readonly string[];
  genericEnvKeys: readonly string[];
  defaultValue?: string;
}

interface AiDirectConfigOverrides {
  model?: string;
  binaryPath?: string;
  homePath?: string;
  baseUrl?: string;
}

interface ResolveProviderConfigOptions {
  preferences: AiPreferences;
  env: EnvMap;
  provider: AiProvider;
  activeProviderForLegacy: AiProvider | "none" | null;
  overrides?: AiDirectConfigOverrides;
  defaultModel?: string;
}

interface ResolveSlotConfigOptions {
  preferences: AiPreferences;
  slot: AiModelSlot;
  providerSelection: ResolvedProviderSelection;
  providerConfigs: Record<AiProvider, AiProviderResolvedConfig>;
}

interface AiProviderStatusConfig {
  binaryPath: string | null;
  baseUrl: string | null;
}

const GENERIC_ENV_KEYS = {
  provider: ["DISPATCH_AI_PROVIDER"],
  model: ["DISPATCH_AI_MODEL"],
  binaryPath: ["DISPATCH_AI_BINARY_PATH"],
  homePath: ["DISPATCH_AI_HOME_PATH"],
  baseUrl: ["DISPATCH_AI_BASE_URL"],
} as const;

const PROVIDER_ENV_KEYS: Record<AiProvider, ProviderEnvKeys> = {
  codex: {
    model: ["CODEX_MODEL"],
    binaryPath: ["CODEX_BINARY_PATH"],
    homePath: ["CODEX_HOME"],
    baseUrl: [],
  },
  claude: {
    model: ["CLAUDE_MODEL"],
    binaryPath: ["CLAUDE_BINARY_PATH"],
    homePath: [],
    baseUrl: [],
  },
  copilot: {
    model: ["COPILOT_MODEL"],
    binaryPath: ["COPILOT_BINARY_PATH"],
    homePath: [],
    baseUrl: [],
  },
  ollama: {
    model: ["OLLAMA_MODEL"],
    binaryPath: [],
    homePath: [],
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
    case "codex":
    case "claude":
    case "copilot":
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

  const candidates = (Object.entries(PROVIDER_ENV_KEYS) as Array<[AiProvider, ProviderEnvKeys]>)
    .map(([provider, keys]) => {
      const lookup = pickEnvValue(env, [
        ...keys.model,
        ...keys.binaryPath,
        ...keys.homePath,
        ...keys.baseUrl,
      ]);
      if (!lookup.value) {
        return null;
      }

      return {
        provider,
        envVar: lookup.envVar,
      };
    })
    .filter(Boolean) as Array<{ provider: AiProvider; envVar: string | null }>;

  if (candidates.length !== 1) {
    return { value: null, envVar: null };
  }

  const [candidate] = candidates;

  return {
    value: candidate?.provider ?? null,
    envVar: candidate?.envVar ?? null,
  };
}

function resolveLegacyProviderSelection(
  preferences: AiPreferences,
  env: EnvMap,
): ResolvedProviderSelection {
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

function resolveProviderValue({
  preferenceValue,
  env,
  overrideValue,
  envKeys,
  genericEnvKeys,
  defaultValue,
}: ResolveProviderValueOptions): ResolvedValue {
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

function coercePublicSource(source: AiResolutionSource): AiConfigSource {
  return source === "argument" ? "preference" : source;
}

function resolveProviderConfig({
  preferences,
  env,
  provider,
  activeProviderForLegacy,
  overrides = {},
  defaultModel = DEFAULT_AI_MODEL_BY_PROVIDER[provider],
}: ResolveProviderConfigOptions): AiProviderResolvedConfig {
  const providerEnvKeys = PROVIDER_ENV_KEYS[provider];
  const modelResult = resolveProviderValue({
    preferenceValue: getAiProviderPreferenceValue(preferences, provider, {
      field: "model",
      activeProvider: activeProviderForLegacy,
    }),
    env,
    overrideValue: overrides.model,
    envKeys: providerEnvKeys.model,
    genericEnvKeys: GENERIC_ENV_KEYS.model,
    defaultValue: defaultModel,
  });

  const binaryPathResult =
    provider === "ollama"
      ? { value: null, source: "none" as const satisfies AiResolutionSource, envVar: null }
      : resolveProviderValue({
          preferenceValue: getAiProviderPreferenceValue(preferences, provider, {
            field: "binaryPath",
            activeProvider: activeProviderForLegacy,
          }),
          env,
          overrideValue: overrides.binaryPath,
          envKeys: providerEnvKeys.binaryPath,
          genericEnvKeys: GENERIC_ENV_KEYS.binaryPath,
          defaultValue: DEFAULT_AI_BINARY_PATH_BY_PROVIDER[provider],
        });

  const homePathResult =
    provider === "codex"
      ? resolveProviderValue({
          preferenceValue: getAiProviderPreferenceValue(preferences, provider, {
            field: "homePath",
            activeProvider: activeProviderForLegacy,
          }),
          env,
          overrideValue: overrides.homePath,
          envKeys: providerEnvKeys.homePath,
          genericEnvKeys: GENERIC_ENV_KEYS.homePath,
        })
      : { value: null, source: "none" as const satisfies AiResolutionSource, envVar: null };

  const baseUrlResult =
    provider === "ollama"
      ? resolveProviderValue({
          preferenceValue: getAiProviderPreferenceValue(preferences, provider, {
            field: "baseUrl",
            activeProvider: activeProviderForLegacy,
          }),
          env,
          overrideValue: overrides.baseUrl,
          envKeys: providerEnvKeys.baseUrl,
          genericEnvKeys: GENERIC_ENV_KEYS.baseUrl,
          defaultValue: DEFAULT_AI_BASE_URL_BY_PROVIDER.ollama,
        })
      : { value: null, source: "none" as const satisfies AiResolutionSource, envVar: null };

  const isConfigured =
    modelResult.value !== null && (provider === "ollama" || binaryPathResult.value !== null);

  return {
    provider,
    model: modelResult.value,
    binaryPath: binaryPathResult.value,
    homePath: homePathResult.value,
    baseUrl: baseUrlResult.value,
    isConfigured,
    modelSource: coercePublicSource(modelResult.source),
    binaryPathSource: coercePublicSource(binaryPathResult.source),
    homePathSource: coercePublicSource(homePathResult.source),
    baseUrlSource: coercePublicSource(baseUrlResult.source),
    modelEnvVar: modelResult.envVar,
    binaryPathEnvVar: binaryPathResult.envVar,
    homePathEnvVar: homePathResult.envVar,
    baseUrlEnvVar: baseUrlResult.envVar,
  };
}

function createEmptySlotConfig(
  slot: AiModelSlot,
  providerSource: AiConfigSource,
): AiSlotResolvedConfig {
  return {
    slot,
    provider: null,
    model: null,
    binaryPath: null,
    homePath: null,
    baseUrl: null,
    isConfigured: false,
    providerSource,
    modelSource: "none",
    binaryPathSource: "none",
    homePathSource: "none",
    baseUrlSource: "none",
    providerEnvVar: null,
    modelEnvVar: null,
    binaryPathEnvVar: null,
    homePathEnvVar: null,
    baseUrlEnvVar: null,
  };
}

function resolveSlotProviderSelection(
  preferences: AiPreferences,
  slot: AiModelSlot,
  fallback: ResolvedProviderSelection,
): ResolvedProviderSelection {
  const explicitProvider = normalizeProvider(
    preferences[getAiModelSlotPreferenceKey(slot, "provider") as AiPreferenceKey],
  );

  if (explicitProvider) {
    return {
      provider: explicitProvider === "none" ? null : explicitProvider,
      source: "preference",
      envVar: null,
    };
  }

  return fallback;
}

function resolveSlotConfig({
  preferences,
  slot,
  providerSelection,
  providerConfigs,
}: ResolveSlotConfigOptions): AiSlotResolvedConfig {
  if (!providerSelection.provider) {
    return createEmptySlotConfig(slot, coercePublicSource(providerSelection.source));
  }

  const providerConfig = providerConfigs[providerSelection.provider];
  const explicitModel = normalizeValue(
    preferences[getAiModelSlotPreferenceKey(slot, "model") as AiPreferenceKey],
  );
  const inheritedProviderModel =
    providerConfig.modelSource === "default" ? null : providerConfig.model;
  const model =
    explicitModel ??
    inheritedProviderModel ??
    DEFAULT_AI_MODEL_BY_SLOT_AND_PROVIDER[slot][providerSelection.provider];
  const modelSource: AiConfigSource = explicitModel
    ? "preference"
    : inheritedProviderModel
      ? providerConfig.modelSource
      : "default";
  const modelEnvVar = explicitModel
    ? null
    : inheritedProviderModel
      ? providerConfig.modelEnvVar
      : null;

  return {
    slot,
    provider: providerSelection.provider,
    model,
    binaryPath: providerConfig.binaryPath,
    homePath: providerConfig.homePath,
    baseUrl: providerConfig.baseUrl,
    isConfigured:
      model !== null &&
      (providerSelection.provider === "ollama" || providerConfig.binaryPath !== null),
    providerSource: coercePublicSource(providerSelection.source),
    modelSource,
    binaryPathSource: providerConfig.binaryPathSource,
    homePathSource: providerConfig.homePathSource,
    baseUrlSource: providerConfig.baseUrlSource,
    providerEnvVar: providerSelection.envVar,
    modelEnvVar,
    binaryPathEnvVar: providerConfig.binaryPathEnvVar,
    homePathEnvVar: providerConfig.homePathEnvVar,
    baseUrlEnvVar: providerConfig.baseUrlEnvVar,
  };
}

function resolveTaskConfig(
  preferences: AiPreferences,
  task: AiTaskId,
  slots: Record<AiModelSlot, AiSlotResolvedConfig>,
): AiTaskResolvedConfig {
  const explicitSlot = normalizeAiTaskSlot(
    preferences[getAiTaskSlotPreferenceKey(task) as AiPreferenceKey],
  );
  const selectedSlot = explicitSlot ?? DEFAULT_AI_TASK_SLOT[task];
  const slotConfig = slots[selectedSlot];

  return {
    ...slotConfig,
    task,
    selectedSlot,
    selectedSlotSource: explicitSlot ? "preference" : "default",
  };
}

export function resolveAiConfigFromSources(
  preferences: AiPreferences,
  env: EnvMap,
): AiResolvedConfig {
  const legacyProviderSelection = resolveLegacyProviderSelection(preferences, env);
  const activeProviderForLegacy = legacyProviderSelection.provider;
  const providers = {
    codex: resolveProviderConfig({
      preferences,
      env,
      provider: "codex",
      activeProviderForLegacy,
    }),
    claude: resolveProviderConfig({
      preferences,
      env,
      provider: "claude",
      activeProviderForLegacy,
    }),
    copilot: resolveProviderConfig({
      preferences,
      env,
      provider: "copilot",
      activeProviderForLegacy,
    }),
    ollama: resolveProviderConfig({
      preferences,
      env,
      provider: "ollama",
      activeProviderForLegacy,
    }),
  } as const satisfies Record<AiProvider, AiProviderResolvedConfig>;

  const bigProviderSelection = resolveSlotProviderSelection(
    preferences,
    "big",
    legacyProviderSelection,
  );
  const smallProviderFallback =
    bigProviderSelection.provider === null ? legacyProviderSelection : bigProviderSelection;
  const smallProviderSelection = resolveSlotProviderSelection(
    preferences,
    "small",
    smallProviderFallback,
  );

  const slots = {
    big: resolveSlotConfig({
      preferences,
      slot: "big",
      providerSelection: bigProviderSelection,
      providerConfigs: providers,
    }),
    small: resolveSlotConfig({
      preferences,
      slot: "small",
      providerSelection: smallProviderSelection,
      providerConfigs: providers,
    }),
  } as const satisfies Record<AiModelSlot, AiSlotResolvedConfig>;

  const tasks = {
    codeExplanation: resolveTaskConfig(preferences, "codeExplanation", slots),
    failureExplanation: resolveTaskConfig(preferences, "failureExplanation", slots),
    reviewSummary: resolveTaskConfig(preferences, "reviewSummary", slots),
    reviewConfidence: resolveTaskConfig(preferences, "reviewConfidence", slots),
    triage: resolveTaskConfig(preferences, "triage", slots),
    commentSuggestions: resolveTaskConfig(preferences, "commentSuggestions", slots),
  } as const satisfies Record<AiTaskId, AiTaskResolvedConfig>;

  return {
    isConfigured: Object.values(slots).some((slot) => slot.isConfigured),
    providers,
    slots,
    tasks,
  };
}

export function getAiConfig(): AiResolvedConfig {
  return resolveAiConfigFromSources(readAiPreferences(), process.env);
}

export function getAiTaskConfigWithSecrets(task: AiTaskId): AiTaskResolvedConfig {
  return getAiConfig().tasks[task];
}

export function getAiSlotConfigWithSecrets(slot: AiModelSlot): AiSlotResolvedConfig {
  return getAiConfig().slots[slot];
}

export function getAiProviderConfigWithSecrets(
  provider: AiProvider,
  overrides: AiDirectConfigOverrides = {},
): AiSlotResolvedConfig {
  const preferences = readAiPreferences();
  const legacyProviderSelection = resolveLegacyProviderSelection(preferences, process.env);
  const providerConfig = resolveProviderConfig({
    preferences,
    env: process.env,
    provider,
    activeProviderForLegacy: legacyProviderSelection.provider,
    overrides,
  });

  return {
    slot: "big",
    provider,
    model: providerConfig.model,
    binaryPath: providerConfig.binaryPath,
    homePath: providerConfig.homePath,
    baseUrl: providerConfig.baseUrl,
    isConfigured: providerConfig.isConfigured,
    providerSource: "preference",
    modelSource: providerConfig.modelSource,
    binaryPathSource: providerConfig.binaryPathSource,
    homePathSource: providerConfig.homePathSource,
    baseUrlSource: providerConfig.baseUrlSource,
    providerEnvVar: null,
    modelEnvVar: providerConfig.modelEnvVar,
    binaryPathEnvVar: providerConfig.binaryPathEnvVar,
    homePathEnvVar: providerConfig.homePathEnvVar,
    baseUrlEnvVar: providerConfig.baseUrlEnvVar,
  };
}

export function getAiProviderStatusConfig(
  provider: AiProvider,
  env: EnvMap = process.env,
): AiProviderStatusConfig {
  const preferences = readAiPreferences();
  const legacyProviderSelection = resolveLegacyProviderSelection(preferences, env);
  const providerConfig = resolveProviderConfig({
    preferences,
    env,
    provider,
    activeProviderForLegacy: legacyProviderSelection.provider,
  });

  return {
    binaryPath: providerConfig.binaryPath,
    baseUrl: providerConfig.baseUrl,
  };
}
