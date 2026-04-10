import type {
  AiModelSlot,
  AiProvider,
  AiProviderStatus,
  AiResolvedConfig,
  AiReviewSummaryCacheEntry,
  AiTaskId,
  AiTriageCacheEntry,
} from "../../ipc";

export interface AiIpcApi {
  "ai.config": {
    args: void;
    result: AiResolvedConfig;
  };
  "ai.providersStatus": {
    args: void;
    result: AiProviderStatus[];
  };
  "ai.complete": {
    args: {
      cwd?: string;
      task?: AiTaskId;
      slot?: AiModelSlot;
      provider?: AiProvider;
      model?: string;
      binaryPath?: string;
      homePath?: string;
      baseUrl?: string;
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      maxTokens?: number;
    };
    result: string;
  };
  "ai.test": {
    args: {
      cwd?: string;
      provider: AiProvider;
      model?: string;
      binaryPath?: string;
      homePath?: string;
      baseUrl?: string;
    };
    result: string;
  };
  "ai.reviewSummary.get": {
    args: { nwo: string; prNumber: number };
    result: AiReviewSummaryCacheEntry | null;
  };
  "ai.reviewSummary.set": {
    args: {
      nwo: string;
      prNumber: number;
      snapshotKey: string;
      summary: string;
      confidenceScore: number | null;
    };
    result: AiReviewSummaryCacheEntry;
  };
  "ai.triage.get": {
    args: { nwo: string; prNumber: number };
    result: AiTriageCacheEntry | null;
  };
  "ai.triage.set": {
    args: { nwo: string; prNumber: number; snapshotKey: string; payload: string };
    result: AiTriageCacheEntry;
  };
}
