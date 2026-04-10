import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { MarkdownBody } from "@/renderer/components/shared/markdown-body";
import { useAiTaskConfig } from "@/renderer/hooks/ai/use-ai-task-config";
import { ipc } from "@/renderer/lib/app/ipc";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import {
  buildAiReviewContext,
  buildAiReviewConfidencePrompt,
  buildAiReviewSummaryPrompt,
  buildAiReviewSummarySnapshotKey,
  parseAiReviewConfidencePayload,
  parseAiReviewSummaryPayload,
} from "@/shared/ai-review-summary";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import { startTransition, type ReactNode, useMemo, useState } from "react";

/**
 * AI review summary — Phase 3 §3.3.3
 *
 * Generates a structured summary of the entire PR.
 * Uses the configured AI provider directly.
 */

interface AiReviewSummaryProps {
  prNumber: number;
  prTitle: string;
  prBody: string;
  author: string;
  files: ReadonlyArray<{ path: string; additions: number; deletions: number }>;
  diffSnippet: string;
  variant?: "section" | "card";
}

export function AiReviewSummary({
  prNumber,
  prTitle,
  prBody,
  author,
  files,
  diffSnippet,
  variant = "section",
}: AiReviewSummaryProps) {
  const summaryConfig = useAiTaskConfig("reviewSummary");
  const confidenceConfig = useAiTaskConfig("reviewConfidence");
  const { nwo, cwd } = useWorkspace();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);
  const isCard = variant === "card";
  const summaryCacheQueryKey = ["ai", "reviewSummary", nwo, prNumber] as const;
  const reviewContext = useMemo(
    () =>
      buildAiReviewContext({
        prNumber,
        prTitle,
        prBody,
        author,
        files,
        diffSnippet,
      }),
    [author, diffSnippet, files, prBody, prNumber, prTitle],
  );
  const summarySnapshotKey = useMemo(
    () =>
      buildAiReviewSummarySnapshotKey({
        prNumber,
        prTitle,
        prBody,
        author,
        files,
        diffSnippet,
      }),
    [author, diffSnippet, files, prBody, prNumber, prTitle],
  );

  const summaryQuery = useQuery({
    queryKey: summaryCacheQueryKey,
    queryFn: () => ipc("ai.reviewSummary.get", { nwo, prNumber }),
    enabled: summaryConfig.isConfigured,
    staleTime: 30_000,
  });

  const summarizeMutation = useMutation({
    mutationFn: async () => {
      const summaryPrompt = buildAiReviewSummaryPrompt({
        prNumber,
        prTitle,
        prBody,
        author,
        files,
        diffSnippet,
      });
      const summaryRequest = ipc("ai.complete", {
        cwd: cwd ?? undefined,
        task: "reviewSummary",
        messages: [
          {
            role: "system",
            content: summaryPrompt.systemPrompt,
          },
          {
            role: "user",
            content: summaryPrompt.userPrompt,
          },
        ],
        maxTokens: 192,
      });
      const confidenceRequest = confidenceConfig.isConfigured
        ? (() => {
            const confidencePrompt = buildAiReviewConfidencePrompt({
              prNumber,
              prTitle,
              prBody,
              author,
              files,
              diffSnippet,
            });

            return ipc("ai.complete", {
              cwd: cwd ?? undefined,
              task: "reviewConfidence",
              messages: [
                {
                  role: "system",
                  content: confidencePrompt.systemPrompt,
                },
                {
                  role: "user",
                  content: confidencePrompt.userPrompt,
                },
              ],
              maxTokens: 96,
            });
          })()
        : Promise.resolve<string | null>(null);

      const [summaryResponse, confidenceResponse] = await Promise.all([
        summaryRequest,
        confidenceRequest,
      ]);

      const summaryPayload = parseAiReviewSummaryPayload(summaryResponse);
      const confidencePayload = confidenceResponse
        ? parseAiReviewConfidencePayload(confidenceResponse)
        : null;
      if (!summaryPayload) {
        throw new Error("AI summary returned invalid JSON.");
      }
      if (confidenceResponse && !confidencePayload) {
        throw new Error("AI confidence returned invalid JSON.");
      }

      return ipc("ai.reviewSummary.set", {
        nwo,
        prNumber,
        snapshotKey: summarySnapshotKey,
        summary: summaryPayload.summary,
        confidenceScore: confidencePayload?.confidenceScore ?? null,
      });
    },
    onSuccess: (entry) => {
      startTransition(() => {
        queryClient.setQueryData(summaryCacheQueryKey, entry);
        setDismissed(false);
      });
    },
  });

  if (!summaryConfig.isConfigured) {
    return null;
  }

  const containerClassName = isCard
    ? "bg-bg-raised border-border mt-2.5 overflow-hidden rounded-lg border"
    : "border-border border-b";
  const headerPaddingClassName = isCard ? "px-3 py-3" : "px-4 py-3";
  const collapsedButtonClassName = isCard
    ? "hover:bg-bg-elevated/70 flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 transition-colors"
    : "hover:bg-bg-raised/60 flex w-full cursor-pointer items-center gap-2 px-4 py-2 transition-colors";
  const cardTriggerClassName =
    "text-accent-text hover:bg-bg-elevated flex w-full cursor-pointer items-center gap-1.5 px-3 py-2.5 text-left text-[11px] font-medium transition-colors";
  const cachedSummary = summaryQuery.data;
  const summaryText = cachedSummary?.summary ?? null;
  const confidenceScore = cachedSummary?.confidenceScore ?? null;
  const summaryNeedsRefresh = Boolean(
    cachedSummary && cachedSummary.snapshotKey !== summarySnapshotKey,
  );
  const showCompactCardTrigger =
    isCard &&
    !dismissed &&
    !summaryText &&
    !summarizeMutation.isPending &&
    !summarizeMutation.isError;

  if (showCompactCardTrigger) {
    return (
      <div className={containerClassName}>
        <button
          type="button"
          onClick={() => summarizeMutation.mutate()}
          className={cardTriggerClassName}
        >
          <Sparkles
            size={10}
            className="shrink-0"
          />
          <span>AI Summary</span>
          <span className="text-text-tertiary ml-auto font-mono text-[9px] font-medium tracking-[0.04em] uppercase">
            Generate
          </span>
        </button>
      </div>
    );
  }

  if (dismissed) {
    return (
      <div className={containerClassName}>
        <button
          type="button"
          onClick={() => setDismissed(false)}
          className={isCard ? cardTriggerClassName : collapsedButtonClassName}
        >
          <Sparkles
            size={12}
            className={isCard ? "shrink-0" : "text-primary"}
          />
          <span
            className={
              isCard
                ? "text-accent-text"
                : "text-text-ghost text-[10px] font-semibold tracking-[0.06em] uppercase"
            }
          >
            AI Summary
          </span>
          {isCard && (
            <span className="text-text-tertiary ml-auto font-mono text-[9px] font-medium tracking-[0.04em] uppercase">
              Show
            </span>
          )}
        </button>
      </div>
    );
  }

  // Estimate token count (rough: ~4 chars per token)
  const estimatedTokens = Math.round(
    (prBody.length +
      files.reduce((sum, file) => sum + file.path.length + 20, 0) +
      reviewContext.usedDiffChars) /
      4,
  );

  return (
    <div className={containerClassName}>
      <div className={headerPaddingClassName}>
        <div className="flex items-center gap-2">
          <Sparkles
            size={14}
            className="text-primary"
          />
          <span className="text-text-tertiary text-[10px] font-semibold tracking-[0.06em] uppercase">
            AI Summary
          </span>
          {confidenceScore !== null && (
            <AiConfidenceBadge
              score={confidenceScore}
              compact={isCard}
            />
          )}
          <div className="flex-1" />
          {isCard && summaryText && (
            <button
              type="button"
              onClick={() => summarizeMutation.mutate()}
              disabled={summarizeMutation.isPending}
              className="text-text-tertiary hover:text-accent-text cursor-pointer font-mono text-[9px] font-medium tracking-[0.04em] uppercase transition-colors disabled:cursor-default disabled:opacity-50"
            >
              Refresh
            </button>
          )}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-text-ghost hover:text-text-primary cursor-pointer p-0.5"
          >
            <X size={11} />
          </button>
        </div>

        {summarizeMutation.isPending ? (
          <div className="mt-2 flex flex-col gap-2.5">
            <ReviewScopeSummary
              reviewContext={reviewContext}
              compact={isCard}
            />
            <div className="flex items-center gap-2">
              <Spinner className="text-primary h-3.5 w-3.5" />
              <span className="text-text-secondary text-xs">
                {summaryText ? "Refreshing summary…" : "Generating a short summary…"}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-full rounded-sm" />
              <Skeleton className="h-3 w-4/5 rounded-sm" />
              <Skeleton className="h-3 w-3/5 rounded-sm" />
            </div>
          </div>
        ) : summaryText ? (
          <div className="mt-2">
            <ReviewScopeSummary
              reviewContext={reviewContext}
              compact={isCard}
            />
            {summaryNeedsRefresh && (
              <div className="border-warning/30 bg-warning/10 mb-2 rounded-md border px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-warning text-[10px] font-semibold tracking-[0.06em] uppercase">
                    Summary Out Of Date
                  </span>
                  <button
                    type="button"
                    onClick={() => summarizeMutation.mutate()}
                    disabled={summarizeMutation.isPending}
                    className="text-warning hover:text-accent-text ml-auto cursor-pointer font-mono text-[9px] font-medium tracking-[0.04em] uppercase transition-colors disabled:cursor-default disabled:opacity-50"
                  >
                    {summarizeMutation.isPending ? "Refreshing" : "Refresh"}
                  </button>
                </div>
                <p className="text-text-secondary mt-1 text-xs">
                  This PR changed since the last summary was generated.
                </p>
              </div>
            )}
            {summarizeMutation.isError && (
              <p className="text-destructive mb-2 text-xs">
                {String((summarizeMutation.error as Error)?.message ?? "Failed")}
              </p>
            )}
            <MarkdownBody
              content={summaryText || "No summary was returned."}
              className="text-xs"
            />
          </div>
        ) : summarizeMutation.isError ? (
          <p className="text-destructive mt-2 text-xs">
            {String((summarizeMutation.error as Error)?.message ?? "Failed")}
          </p>
        ) : (
          <div className="mt-2">
            <ReviewScopeSummary
              reviewContext={reviewContext}
              compact={isCard}
            />
            {!isCard && (
              <>
                <p className="text-text-tertiary mb-2 text-[10px]">
                  ~{estimatedTokens} tokens · Uses your configured AI provider.
                </p>
                <button
                  type="button"
                  className="border-primary/30 text-primary hover:bg-primary/10 inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors"
                  onClick={() => summarizeMutation.mutate()}
                >
                  <Sparkles size={12} />
                  Generate summary
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AiConfidenceBadge({ score, compact = false }: { score: number; compact?: boolean }) {
  const className =
    score >= 75
      ? "bg-success-muted text-success"
      : score >= 45
        ? "bg-warning-muted text-warning"
        : "bg-danger-muted text-destructive";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`AI confidence score ${score} out of 100`}
            className={`inline-flex cursor-help items-center rounded-sm font-mono font-medium ${className}`}
            style={{
              padding: compact ? "1px 5px" : "1px 6px",
              fontSize: compact ? "9px" : "10px",
            }}
          >
            AI {score}/100
          </button>
        }
      />
      <TooltipPopup className="max-w-64 text-[11px] leading-4">
        Confidence score for how much of the review surface is visible from the supplied PR
        description, changed files, and diff context. Higher scores mean the summary likely has
        enough context; lower scores mean the PR is broader, riskier, or more partial.
      </TooltipPopup>
    </Tooltip>
  );
}

function ReviewScopeSummary({
  reviewContext,
  compact = false,
}: {
  reviewContext: ReturnType<typeof buildAiReviewContext>;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "mb-2 flex flex-col gap-1" : "mb-2.5 flex flex-col gap-1.5"}>
      <div className="flex flex-wrap items-center gap-1.5">
        <ScopeBadge>
          {reviewContext.coveredFiles}/{reviewContext.totalFiles} files
        </ScopeBadge>
        <ScopeBadge>
          {formatDiffSize(reviewContext.usedDiffChars)}/
          {formatDiffSize(reviewContext.totalDiffChars)} diff
        </ScopeBadge>
        <ScopeBadge>
          {reviewContext.truncated ? "Partial diff context" : "Full diff context"}
        </ScopeBadge>
        <ScopeBadge>Changed files only</ScopeBadge>
      </div>
      <p className="text-text-secondary text-[10px] leading-4">
        Uses PR description, changed-file metadata, and changed diff content. Dispatch does not scan
        unchanged repository files for this review.
      </p>
    </div>
  );
}

function ScopeBadge({ children }: { children: ReactNode }) {
  return (
    <span className="border-border bg-bg-raised text-text-secondary inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[9px] font-medium">
      {children}
    </span>
  );
}

function formatDiffSize(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }

  return String(value);
}
