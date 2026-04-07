import type {
  AiModelSlot,
  AiProvider,
  AiProviderResolvedConfig,
  AiResolvedConfig,
  AiTaskId,
  AiTaskResolvedConfig,
} from "@/shared/ipc";

import { ipc } from "@/renderer/lib/app/ipc";
import { useQuery } from "@tanstack/react-query";

function createFallbackProviderConfig(provider: AiProvider): AiProviderResolvedConfig {
  return {
    provider,
    model: null,
    suggestedModels: [],
    binaryPath: null,
    homePath: null,
    baseUrl: null,
    isConfigured: false,
    modelSource: "none",
    binaryPathSource: "none",
    homePathSource: "none",
    baseUrlSource: "none",
    modelEnvVar: null,
    binaryPathEnvVar: null,
    homePathEnvVar: null,
    baseUrlEnvVar: null,
  };
}

function createFallbackTaskConfig(task: AiTaskId, selectedSlot: AiModelSlot): AiTaskResolvedConfig {
  return {
    task,
    selectedSlot,
    selectedSlotSource: "default",
    slot: selectedSlot,
    provider: null,
    model: null,
    binaryPath: null,
    homePath: null,
    baseUrl: null,
    isConfigured: false,
    providerSource: "none",
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

const FALLBACK_AI_CONFIG: AiResolvedConfig = {
  isConfigured: false,
  providers: {
    codex: createFallbackProviderConfig("codex"),
    claude: createFallbackProviderConfig("claude"),
    copilot: createFallbackProviderConfig("copilot"),
    ollama: createFallbackProviderConfig("ollama"),
    opencode: createFallbackProviderConfig("opencode"),
  },
  slots: {
    big: {
      slot: "big",
      provider: null,
      model: null,
      binaryPath: null,
      homePath: null,
      baseUrl: null,
      isConfigured: false,
      providerSource: "none",
      modelSource: "none",
      binaryPathSource: "none",
      homePathSource: "none",
      baseUrlSource: "none",
      providerEnvVar: null,
      modelEnvVar: null,
      binaryPathEnvVar: null,
      homePathEnvVar: null,
      baseUrlEnvVar: null,
    },
    small: {
      slot: "small",
      provider: null,
      model: null,
      binaryPath: null,
      homePath: null,
      baseUrl: null,
      isConfigured: false,
      providerSource: "none",
      modelSource: "none",
      binaryPathSource: "none",
      homePathSource: "none",
      baseUrlSource: "none",
      providerEnvVar: null,
      modelEnvVar: null,
      binaryPathEnvVar: null,
      homePathEnvVar: null,
      baseUrlEnvVar: null,
    },
  },
  tasks: {
    codeExplanation: createFallbackTaskConfig("codeExplanation", "small"),
    failureExplanation: createFallbackTaskConfig("failureExplanation", "small"),
    reviewSummary: createFallbackTaskConfig("reviewSummary", "big"),
    reviewConfidence: createFallbackTaskConfig("reviewConfidence", "small"),
    triage: createFallbackTaskConfig("triage", "small"),
    commentSuggestions: createFallbackTaskConfig("commentSuggestions", "big"),
  },
};

export function useAiConfig(): AiResolvedConfig {
  const configQuery = useQuery({
    queryKey: ["ai", "config"],
    queryFn: () => ipc("ai.config"),
    staleTime: 60_000,
  });

  const enabledQuery = useQuery({
    queryKey: ["preferences", "aiEnabled"],
    queryFn: () => ipc("preferences.get", { key: "aiEnabled" }),
    staleTime: 30_000,
  });

  if (enabledQuery.data !== "true") {
    return FALLBACK_AI_CONFIG;
  }

  return configQuery.data ?? FALLBACK_AI_CONFIG;
}

export function useAiTaskConfig(task: AiTaskId): AiTaskResolvedConfig {
  return useAiConfig().tasks[task];
}
