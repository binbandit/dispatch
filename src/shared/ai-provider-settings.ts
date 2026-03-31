import type { AiModelSlot, AiProvider, AiTaskId } from "./ipc";

export interface AiProviderModelOption {
  label: string;
  value: string;
}

export type AiProviderPreferenceField = "model" | "binaryPath" | "homePath" | "baseUrl";
export type AiModelSlotPreferenceField = "provider" | "model";

interface ScopedProviderPreferenceKeys {
  model: string;
  binaryPath: string | null;
  homePath: string | null;
  baseUrl: string | null;
}

interface ScopedSlotPreferenceKeys {
  provider: string;
  model: string;
}

export const LEGACY_AI_PREFERENCE_KEYS = {
  provider: "aiProvider",
  model: "aiModel",
  binaryPath: "aiBinaryPath",
  homePath: "aiHomePath",
  baseUrl: "aiBaseUrl",
} as const;

export const AI_MODEL_SLOT_PREFERENCE_KEYS: Record<AiModelSlot, ScopedSlotPreferenceKeys> = {
  big: {
    provider: "aiBigProvider",
    model: "aiBigModel",
  },
  small: {
    provider: "aiSmallProvider",
    model: "aiSmallModel",
  },
};

export const AI_TASK_SLOT_PREFERENCE_KEYS: Record<AiTaskId, string> = {
  codeExplanation: "aiTaskCodeExplanationSlot",
  failureExplanation: "aiTaskFailureExplanationSlot",
  reviewSummary: "aiTaskReviewSummarySlot",
  reviewConfidence: "aiTaskReviewConfidenceSlot",
  triage: "aiTaskTriageSlot",
  commentSuggestions: "aiTaskCommentSuggestionsSlot",
};

export const AI_PROVIDER_PREFERENCE_KEYS: Record<AiProvider, ScopedProviderPreferenceKeys> = {
  codex: {
    model: "aiCodexModel",
    binaryPath: "aiCodexBinaryPath",
    homePath: "aiCodexHomePath",
    baseUrl: null,
  },
  claude: {
    model: "aiClaudeModel",
    binaryPath: "aiClaudeBinaryPath",
    homePath: null,
    baseUrl: null,
  },
  copilot: {
    model: "aiCopilotModel",
    binaryPath: "aiCopilotBinaryPath",
    homePath: null,
    baseUrl: null,
  },
  ollama: {
    model: "aiOllamaModel",
    binaryPath: null,
    homePath: null,
    baseUrl: "aiOllamaBaseUrl",
  },
};

export const AI_PROVIDER_SCOPED_PREFERENCE_KEYS = [
  "aiCodexModel",
  "aiCodexBinaryPath",
  "aiCodexHomePath",
  "aiClaudeModel",
  "aiClaudeBinaryPath",
  "aiCopilotModel",
  "aiCopilotBinaryPath",
  "aiOllamaModel",
  "aiOllamaBaseUrl",
] as const;

export const AI_MODEL_SLOT_SCOPED_PREFERENCE_KEYS = [
  "aiBigProvider",
  "aiBigModel",
  "aiSmallProvider",
  "aiSmallModel",
] as const;

export const AI_TASK_SLOT_SCOPED_PREFERENCE_KEYS = [
  "aiTaskCodeExplanationSlot",
  "aiTaskFailureExplanationSlot",
  "aiTaskReviewSummarySlot",
  "aiTaskReviewConfidenceSlot",
  "aiTaskTriageSlot",
  "aiTaskCommentSuggestionsSlot",
] as const;

export const DEFAULT_AI_MODEL_BY_PROVIDER: Record<AiProvider, string> = {
  codex: "gpt-5.4",
  claude: "default",
  copilot: "gpt-5.3-codex",
  ollama: "llama3.1",
};

export const DEFAULT_AI_MODEL_BY_SLOT_AND_PROVIDER: Record<
  AiModelSlot,
  Record<AiProvider, string>
> = {
  big: {
    codex: "gpt-5.4",
    claude: "opus",
    copilot: "gpt-5.3-codex",
    ollama: "llama3.1",
  },
  small: {
    codex: "gpt-5.4-mini",
    claude: "haiku",
    copilot: "claude-haiku-4.5",
    ollama: "qwen2.5-coder",
  },
};

export const DEFAULT_AI_TASK_SLOT: Record<AiTaskId, AiModelSlot> = {
  codeExplanation: "small",
  failureExplanation: "small",
  reviewSummary: "big",
  reviewConfidence: "small",
  triage: "small",
  commentSuggestions: "big",
};

export const AI_TASK_DEFINITIONS: ReadonlyArray<{
  id: AiTaskId;
  label: string;
  description: string;
}> = [
  {
    id: "reviewSummary",
    label: "PR summary",
    description: "Short overview for the PR sidebar and overview tab.",
  },
  {
    id: "reviewConfidence",
    label: "Confidence score",
    description: "Confidence badge for how complete the summary context appears to be.",
  },
  {
    id: "triage",
    label: "Triage",
    description: "Groups files into stable review sections in the sidebar.",
  },
  {
    id: "commentSuggestions",
    label: "Comment suggestions",
    description: "Inline review comment suggestions while you inspect files.",
  },
  {
    id: "codeExplanation",
    label: "Code explanation",
    description: "On-demand explanation for a selected diff snippet.",
  },
  {
    id: "failureExplanation",
    label: "Failed check explanation",
    description: "Plain-English explanation for CI failures and suggested fixes.",
  },
] as const;

export const AI_PROVIDER_MODEL_OPTIONS: Record<AiProvider, readonly AiProviderModelOption[]> = {
  codex: [
    { label: "GPT-5.4", value: "gpt-5.4" },
    { label: "GPT-5.4 Mini", value: "gpt-5.4-mini" },
    { label: "GPT-5.3 Codex", value: "gpt-5.3-codex" },
    { label: "GPT-5.3 Codex Spark", value: "gpt-5.3-codex-spark" },
  ],
  claude: [
    { label: "Default", value: "default" },
    { label: "Opus", value: "opus" },
    { label: "Sonnet", value: "sonnet" },
    { label: "Haiku", value: "haiku" },
    { label: "Opus Plan", value: "opusplan" },
  ],
  copilot: [
    { label: "GPT-5.3 Codex", value: "gpt-5.3-codex" },
    { label: "Claude Haiku 4.5", value: "claude-haiku-4.5" },
  ],
  ollama: [
    { label: "Llama 3.1", value: "llama3.1" },
    { label: "Llama 3.2", value: "llama3.2" },
    { label: "Qwen 2.5 Coder", value: "qwen2.5-coder" },
    { label: "DeepSeek R1", value: "deepseek-r1" },
  ],
};

export const DEFAULT_AI_BINARY_PATH_BY_PROVIDER: Partial<Record<AiProvider, string>> = {
  codex: "codex",
  claude: "claude",
  copilot: "copilot",
};

export const DEFAULT_AI_BASE_URL_BY_PROVIDER: Partial<Record<AiProvider, string>> = {
  ollama: "http://localhost:11434",
};

function normalizePreferenceValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getAiProviderPreferenceKey(
  provider: AiProvider,
  field: AiProviderPreferenceField,
): string | null {
  return AI_PROVIDER_PREFERENCE_KEYS[provider][field];
}

export function getAiModelSlotPreferenceKey(
  slot: AiModelSlot,
  field: AiModelSlotPreferenceField,
): string {
  return AI_MODEL_SLOT_PREFERENCE_KEYS[slot][field];
}

export function getAiTaskSlotPreferenceKey(task: AiTaskId): string {
  return AI_TASK_SLOT_PREFERENCE_KEYS[task];
}

export function getAiProviderPreferenceValue(
  preferences: Record<string, string | null | undefined>,
  provider: AiProvider,
  options: {
    field: AiProviderPreferenceField;
    activeProvider?: AiProvider | "none" | null;
  },
): string | null {
  const activeProvider = options.activeProvider ?? null;
  const { field } = options;
  const scopedKey = getAiProviderPreferenceKey(provider, field);
  const scopedValue = scopedKey ? normalizePreferenceValue(preferences[scopedKey]) : null;
  if (scopedValue) {
    return scopedValue;
  }

  const usesLegacyField =
    field === "model" ||
    (field === "binaryPath" && provider !== "ollama") ||
    (field === "homePath" && provider === "codex") ||
    (field === "baseUrl" && provider === "ollama");

  if (!usesLegacyField || activeProvider !== provider) {
    return null;
  }

  return normalizePreferenceValue(preferences[LEGACY_AI_PREFERENCE_KEYS[field]]);
}

export function resolveAiSlotModelValue(
  slot: AiModelSlot,
  provider: AiProvider,
  options: {
    explicitModel: string | null | undefined;
    fallbackModel?: string | null | undefined;
  },
): string {
  const normalizedExplicitModel = normalizePreferenceValue(options.explicitModel);
  const normalizedFallbackModel = normalizePreferenceValue(options.fallbackModel);

  return (
    normalizedExplicitModel ??
    normalizedFallbackModel ??
    DEFAULT_AI_MODEL_BY_SLOT_AND_PROVIDER[slot][provider]
  );
}

export function getAiProviderModelOptions(
  provider: AiProvider,
  currentModel: string | null | undefined,
): readonly AiProviderModelOption[] {
  const normalizedCurrentModel = normalizePreferenceValue(currentModel);
  const options = AI_PROVIDER_MODEL_OPTIONS[provider];

  if (
    !normalizedCurrentModel ||
    options.some((option) => option.value === normalizedCurrentModel)
  ) {
    return options;
  }

  return [{ label: normalizedCurrentModel, value: normalizedCurrentModel }, ...options];
}

export function normalizeAiTaskSlot(value: string | null | undefined): AiModelSlot | null {
  const normalizedValue = normalizePreferenceValue(value);

  switch (normalizedValue) {
    case "big":
    case "small": {
      return normalizedValue;
    }
    default: {
      return null;
    }
  }
}
