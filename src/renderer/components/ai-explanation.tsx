import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import { useState } from "react";

import { ipc } from "../lib/ipc";

/**
 * AI inline code explanation — Phase 3 §3.3.2
 *
 * Renders below selected code in the diff. Shows streaming-style
 * AI explanation in a copper-bordered card.
 */

interface AiExplanationProps {
  filePath: string;
  codeSnippet: string;
  language: string;
  onDismiss: () => void;
}

function useAiConfig() {
  const prefsQuery = useQuery({
    queryKey: ["preferences", ["aiProvider", "aiModel", "aiApiKey", "aiBaseUrl"]],
    queryFn: () =>
      ipc("preferences.getAll", {
        keys: ["aiProvider", "aiModel", "aiApiKey", "aiBaseUrl"],
      }),
    staleTime: 60_000,
  });

  const prefs = prefsQuery.data ?? {};
  const provider = prefs.aiProvider ?? null;
  const isConfigured = !!provider && provider !== "none";

  return {
    isConfigured,
    provider: provider ?? "openai",
    model:
      prefs.aiModel ??
      (provider === "openai"
        ? "gpt-4o"
        : provider === "anthropic"
          ? "claude-sonnet-4-20250514"
          : "llama3.1"),
    apiKey: prefs.aiApiKey ?? "",
    baseUrl: prefs.aiBaseUrl || undefined,
  };
}

export { useAiConfig };

export function AiExplanation({ filePath, codeSnippet, language, onDismiss }: AiExplanationProps) {
  const config = useAiConfig();
  const [result, setResult] = useState<string | null>(null);

  const explainMutation = useMutation({
    mutationFn: () =>
      ipc("ai.complete", {
        provider: config.provider as "openai" | "anthropic" | "ollama",
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        messages: [
          {
            role: "system",
            content:
              "You are a code review assistant. Explain what the following code change does and why it might have been made. Be concise (2-3 sentences max).",
          },
          {
            role: "user",
            content: `File: ${filePath}\n\nCode:\n\`\`\`${language}\n${codeSnippet}\n\`\`\``,
          },
        ],
        maxTokens: 256,
      }),
    onSuccess: (text) => {
      setResult(text);
    },
  });

  if (!config.isConfigured) {
    return (
      <div className="border-primary/30 bg-bg-surface mx-3 my-1.5 max-w-xl rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <Sparkles
            size={14}
            className="text-primary"
          />
          <span className="text-text-secondary text-xs">
            Configure an AI provider in Settings to use explanations.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="border-primary/30 bg-bg-surface mx-3 my-1.5 max-w-xl rounded-lg border shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <Sparkles
          size={14}
          className="text-primary"
        />
        <span className="text-primary text-[11px] font-medium">AI Explanation</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onDismiss}
          className="text-text-tertiary hover:text-text-primary cursor-pointer p-0.5"
        >
          <X size={12} />
        </button>
      </div>
      <div className="px-3 pb-3">
        {result ? (
          <p className="text-text-secondary text-xs leading-relaxed">{result}</p>
        ) : explainMutation.isPending ? (
          <div className="flex items-center gap-2 py-2">
            <Spinner className="text-primary h-3 w-3" />
            <span className="text-text-tertiary text-xs">Thinking...</span>
          </div>
        ) : explainMutation.isError ? (
          <p className="text-destructive text-xs">
            {String((explainMutation.error as Error)?.message ?? "Failed to get explanation")}
          </p>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="border-primary/30 text-primary hover:bg-primary/10 gap-1.5"
            onClick={() => explainMutation.mutate()}
          >
            <Sparkles size={12} />
            Explain this code
          </Button>
        )}
      </div>
    </div>
  );
}
