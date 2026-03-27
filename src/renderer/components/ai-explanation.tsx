import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import { useState } from "react";

import { useAcpStream } from "../hooks/use-acp-stream";
import { ipc } from "../lib/ipc";
import { useWorkspace } from "../lib/workspace-context";
import { AcpStreamDisplay } from "./acp-stream-display";

/**
 * AI inline code explanation — Phase 3 §3.3.2
 *
 * Renders below selected code in the diff.
 * Uses ACP agent with streaming when available, falls back to direct API.
 */

interface AiExplanationProps {
  filePath: string;
  codeSnippet: string;
  language: string;
  onDismiss: () => void;
}

function useAiConfig() {
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

  const aiEnabled = enabledQuery.data === "true";

  const fallback = {
    provider: null,
    model: null,
    baseUrl: null,
    isConfigured: false,
    hasApiKey: false,
    providerSource: "none" as const,
    modelSource: "none" as const,
    apiKeySource: "none" as const,
    baseUrlSource: "none" as const,
    providerEnvVar: null,
    modelEnvVar: null,
    apiKeyEnvVar: null,
    baseUrlEnvVar: null,
  };

  if (!aiEnabled) {
    return fallback;
  }

  return configQuery.data ?? fallback;
}

export { useAiConfig };

export function AiExplanation({ filePath, codeSnippet, language, onDismiss }: AiExplanationProps) {
  const config = useAiConfig();
  const { cwd } = useWorkspace();
  const [result, setResult] = useState<string | null>(null);
  const [useAcp, setUseAcp] = useState(false);
  const stream = useAcpStream();

  const explainMutation = useMutation({
    mutationFn: async () => {
      const prompt = `You are a code review assistant. Explain what the following code change does and why it might have been made. Be concise (2-3 sentences max).\n\nFile: ${filePath}\n\nCode:\n\`\`\`${language}\n${codeSnippet}\n\`\`\``;

      // Try ACP with streaming
      try {
        const session = await ipc("acp.session.create", { cwd });
        setUseAcp(true);
        stream.start(session.sessionId);

        await ipc("acp.session.prompt", {
          sessionId: session.sessionId,
          text: prompt,
        });

        stream.stop();
        return "acp";
      } catch {
        // Fall back to direct API
        stream.reset();
        setUseAcp(false);

        return ipc("ai.complete", {
          provider: config.provider ?? undefined,
          model: config.model ?? undefined,
          baseUrl: config.baseUrl ?? undefined,
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
        });
      }
    },
    onSuccess: (text) => {
      if (text === "acp") {
        setResult(stream.text);
      } else {
        setResult(text);
      }
    },
  });

  const displayText = useAcp && stream.streaming ? stream.text : result;
  const isStreaming = useAcp && stream.streaming;

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
        {isStreaming ? (
          <AcpStreamDisplay
            text={stream.text}
            tools={stream.tools}
            streaming={stream.streaming}
            className="text-xs leading-relaxed"
          />
        ) : displayText ? (
          <p className="text-text-secondary text-xs leading-relaxed">{displayText}</p>
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
