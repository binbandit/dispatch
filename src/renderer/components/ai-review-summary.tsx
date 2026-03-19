import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import { useState } from "react";

import { ipc } from "../lib/ipc";
import { useAiConfig } from "./ai-explanation";
import { MarkdownBody } from "./markdown-body";

/**
 * AI review summary — Phase 3 §3.3.3
 *
 * Generates a structured summary of the entire PR.
 * Shows in the side panel as a collapsible section.
 */

interface AiReviewSummaryProps {
  prNumber: number;
  prTitle: string;
  prBody: string;
  author: string;
  files: Array<{ path: string; additions: number; deletions: number }>;
  diffSnippet: string;
}

export function AiReviewSummary({
  prNumber,
  prTitle,
  prBody,
  author,
  files,
  diffSnippet,
}: AiReviewSummaryProps) {
  const config = useAiConfig();
  const [summary, setSummary] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const summarizeMutation = useMutation({
    mutationFn: () => {
      const fileList = files
        .slice(0, 30)
        .map((f) => `  ${f.path} (+${f.additions}, -${f.deletions})`)
        .join("\n");

      return ipc("ai.complete", {
        provider: config.provider as "openai" | "anthropic" | "ollama",
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        messages: [
          {
            role: "system",
            content:
              "You are a senior code reviewer. Analyze this pull request and provide a structured review summary. Group changes by logical concern. Identify areas that deserve close review. Be specific and concise. Use markdown formatting.",
          },
          {
            role: "user",
            content: `PR: ${prTitle} #${prNumber}\nAuthor: ${author}\n\nDescription:\n${prBody}\n\nFiles changed:\n${fileList}\n\nDiff (first 3000 chars):\n${diffSnippet.slice(0, 3000)}`,
          },
        ],
        maxTokens: 1024,
      });
    },
    onSuccess: (text) => {
      setSummary(text);
    },
  });

  if (!config.isConfigured || dismissed) {
    return null;
  }

  // Estimate token count (rough: ~4 chars per token)
  const estimatedTokens = Math.round(
    (prBody.length +
      files.reduce((s, f) => s + f.path.length + 20, 0) +
      Math.min(diffSnippet.length, 3000)) /
      4,
  );

  return (
    <div className="border-border border-b">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles
            size={14}
            className="text-primary"
          />
          <span className="text-text-tertiary text-[10px] font-semibold tracking-[0.06em] uppercase">
            AI Summary
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-text-ghost hover:text-text-primary cursor-pointer p-0.5"
          >
            <X size={11} />
          </button>
        </div>

        {summary ? (
          <div className="mt-2">
            <MarkdownBody
              content={summary}
              className="text-xs"
            />
          </div>
        ) : summarizeMutation.isPending ? (
          <div className="mt-2 flex items-center gap-2">
            <Spinner className="text-primary h-3 w-3" />
            <span className="text-text-tertiary text-xs">Generating summary...</span>
          </div>
        ) : summarizeMutation.isError ? (
          <p className="text-destructive mt-2 text-xs">
            {String((summarizeMutation.error as Error)?.message ?? "Failed")}
          </p>
        ) : (
          <div className="mt-2">
            <p className="text-text-tertiary mb-2 text-[10px]">
              ~{estimatedTokens} tokens · This will call your configured AI provider.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="border-primary/30 text-primary hover:bg-primary/10 gap-1.5"
              onClick={() => summarizeMutation.mutate()}
            >
              <Sparkles size={12} />
              Generate summary
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
