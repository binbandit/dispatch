import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import { useState } from "react";

import { useAcpStream } from "../hooks/use-acp-stream";
import { ipc } from "../lib/ipc";
import { useWorkspace } from "../lib/workspace-context";
import { AcpStreamDisplay } from "./acp-stream-display";
import { useAiConfig } from "./ai-explanation";
import { MarkdownBody } from "./markdown-body";

/**
 * AI review summary — Phase 3 §3.3.3
 *
 * Generates a structured summary of the entire PR.
 * Uses ACP agent when available (with streaming), falls back to direct API.
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
  const { cwd } = useWorkspace();
  const [dismissed, setDismissed] = useState(false);
  const [finalText, setFinalText] = useState<string | null>(null);
  const [useAcp, setUseAcp] = useState(false);
  const stream = useAcpStream();

  const summarizeMutation = useMutation({
    mutationFn: async () => {
      const fileList = files
        .slice(0, 30)
        .map((f) => `  ${f.path} (+${f.additions}, -${f.deletions})`)
        .join("\n");

      const prompt = `You are a senior code reviewer. Analyze this pull request and provide a structured review summary. Group changes by logical concern. Identify areas that deserve close review. Be specific and concise. Use markdown formatting.\n\nPR: ${prTitle} #${prNumber}\nAuthor: ${author}\n\nDescription:\n${prBody}\n\nFiles changed:\n${fileList}\n\nDiff (first 3000 chars):\n${diffSnippet.slice(0, 3000)}`;

      // Try ACP with streaming first
      try {
        const session = await ipc("acp.session.create", { cwd });
        setUseAcp(true);
        stream.start(session.sessionId);

        await ipc("acp.session.prompt", {
          sessionId: session.sessionId,
          text: prompt,
        });

        stream.stop();
        return "acp"; // Signal that we used ACP streaming
      } catch {
        // ACP not available — fall back to direct API
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
                "You are a senior code reviewer. Analyze this pull request and provide a structured review summary. Group changes by logical concern. Identify areas that deserve close review. Be specific and concise. Use markdown formatting.",
            },
            {
              role: "user",
              content: `PR: ${prTitle} #${prNumber}\nAuthor: ${author}\n\nDescription:\n${prBody}\n\nFiles changed:\n${fileList}\n\nDiff (first 3000 chars):\n${diffSnippet.slice(0, 3000)}`,
            },
          ],
          maxTokens: 1024,
        });
      }
    },
    onSuccess: (result) => {
      if (result === "acp") {
        // Text was accumulated via streaming — capture final state
        setFinalText(stream.text);
      } else {
        setFinalText(result);
      }
    },
  });

  const displayText = useAcp && stream.streaming ? stream.text : finalText;
  const isStreaming = useAcp && stream.streaming;

  if (!config.isConfigured) {
    return null;
  }

  if (dismissed) {
    return (
      <div className="border-border border-b">
        <button
          type="button"
          onClick={() => setDismissed(false)}
          className="hover:bg-bg-raised/60 flex w-full cursor-pointer items-center gap-2 px-4 py-2 transition-colors"
        >
          <Sparkles
            size={12}
            className="text-primary"
          />
          <span className="text-text-ghost text-[10px] font-semibold tracking-[0.06em] uppercase">
            AI Summary
          </span>
        </button>
      </div>
    );
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

        {/* Streaming ACP response */}
        {isStreaming ? (
          <div className="mt-2">
            <AcpStreamDisplay
              text={stream.text}
              tools={stream.tools}
              streaming={stream.streaming}
              className="text-xs"
            />
          </div>
        ) : displayText ? (
          <div className="mt-2">
            <MarkdownBody
              content={displayText || "No summary was returned."}
              className="text-xs"
            />
          </div>
        ) : summarizeMutation.isPending ? (
          <div className="mt-2 flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <Spinner className="text-primary h-3.5 w-3.5" />
              <span className="text-text-secondary text-xs">Generating summary…</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-full rounded-sm" />
              <Skeleton className="h-3 w-5/6 rounded-sm" />
              <Skeleton className="h-3 w-4/6 rounded-sm" />
              <Skeleton className="mt-1 h-3 w-full rounded-sm" />
              <Skeleton className="h-3 w-3/4 rounded-sm" />
            </div>
          </div>
        ) : summarizeMutation.isError ? (
          <p className="text-destructive mt-2 text-xs">
            {String((summarizeMutation.error as Error)?.message ?? "Failed")}
          </p>
        ) : (
          <div className="mt-2">
            <p className="text-text-tertiary mb-2 text-[10px]">
              ~{estimatedTokens} tokens · Uses your configured agent or AI provider.
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
