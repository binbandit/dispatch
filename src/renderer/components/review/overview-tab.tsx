/* eslint-disable import/max-dependencies -- This tab intentionally gathers overview-only widgets in one place. */
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { AiReviewSummary } from "@/renderer/components/review/ai/ai-review-summary";
import { ConfirmDialog } from "@/renderer/components/shared/confirm-dialog";
import { GitHubAvatar } from "@/renderer/components/shared/github-avatar";
import { MarkdownBody } from "@/renderer/components/shared/markdown-body";
import {
  formatAuthorName,
  useDisplayNameFormat,
} from "@/renderer/hooks/preferences/use-display-name";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { relativeTime } from "@/shared/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { XCircle } from "lucide-react";

/**
 * Overview tab — PR description, reviewers, AI summary.
 * No conversation or comments — those live in the Conversation tab.
 */

export function OverviewTab({
  pr,
  prNumber,
  repo,
  highlightedLogin,
  onReviewClick,
  diffSnippet,
}: {
  pr: {
    title: string;
    body: string;
    author: { login: string; name?: string | null };
    reviewDecision: string;
    reviews: Array<{ author: { login: string }; state: string; submittedAt: string }>;
    files: Array<{ path: string; additions: number; deletions: number }>;
    updatedAt: string;
    url: string;
  };
  prNumber: number;
  repo: string;
  highlightedLogin: string | null;
  onReviewClick: (login: string) => void;
  diffSnippet: string;
}) {
  const { repoTarget, nwo } = useWorkspace();
  const nameFormat = useDisplayNameFormat();

  const reviewRequestsQuery = useQuery({
    queryKey: ["pr", "reviewRequests", nwo, prNumber],
    queryFn: () => ipc("pr.reviewRequests", { ...repoTarget, prNumber }),
  });

  const reviewRequests = reviewRequestsQuery.data ?? [];
  const submittedReviews = dedupeReviews(pr.reviews);
  const submittedLogins = new Set(submittedReviews.map((r) => r.author.login));
  const pendingRequests = reviewRequests.filter((rr) => !submittedLogins.has(rr.login ?? ""));
  const hasReviewers = submittedReviews.length > 0 || pendingRequests.length > 0;

  const closeMutation = useMutation({
    mutationFn: () => ipc("pr.close", { ...repoTarget, prNumber }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      toastManager.add({ title: `PR #${prNumber} closed`, type: "success" });
    },
    onError: (err) => {
      toastManager.add({ title: "Close failed", description: String(err.message), type: "error" });
    },
  });

  return (
    <div className="flex flex-col gap-0">
      {/* AI review summary */}
      <AiReviewSummary
        prNumber={prNumber}
        prTitle={pr.title}
        prBody={pr.body}
        author={pr.author.login}
        files={pr.files}
        diffSnippet={diffSnippet}
      />

      {/* PR description */}
      <div className="border-border border-b px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <GitHubAvatar
            login={pr.author.login}
            size={18}
          />
          <span className="text-text-primary text-[11px] font-medium">
            {formatAuthorName(pr.author, nameFormat)}
          </span>
          <span className="text-text-ghost text-[10px]">authored</span>
        </div>
        {pr.body ? (
          <MarkdownBody
            content={pr.body}
            repo={repo}
          />
        ) : (
          <p className="text-text-tertiary text-xs italic">No description provided.</p>
        )}
      </div>

      {/* Reviewers */}
      {hasReviewers && (
        <div className="border-border border-b px-4 py-3">
          <h3 className="text-text-tertiary mb-2 text-[10px] font-semibold tracking-[0.06em] uppercase">
            Reviewers
          </h3>
          <div className="flex flex-col gap-1.5">
            {/* Submitted reviews */}
            {submittedReviews.map((review) => {
              const isHighlighted = highlightedLogin === review.author.login;
              const request = reviewRequests.find((rr) => rr.login === review.author.login);
              return (
                <button
                  key={review.author.login}
                  type="button"
                  onClick={() => onReviewClick(review.author.login)}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left transition-colors ${
                    isHighlighted ? "bg-primary/10 ring-primary/40 ring-1" : "hover:bg-bg-raised"
                  }`}
                >
                  <GitHubAvatar
                    login={review.author.login}
                    size={16}
                  />
                  <span className="text-text-primary text-[11px] font-medium">
                    {review.author.login}
                  </span>
                  {request?.asCodeOwner && <CodeOwnerBadge />}
                  <ReviewStateBadge state={review.state} />
                  <span className="text-text-ghost ml-auto font-mono text-[10px]">
                    {relativeTime(new Date(review.submittedAt))}
                  </span>
                </button>
              );
            })}
            {/* Pending requested reviewers */}
            {pendingRequests.map((rr) => (
              <div
                key={rr.login ?? rr.name}
                className="hover:bg-bg-raised flex items-center gap-2 rounded-md px-2 py-1"
              >
                {rr.type === "Team" ? (
                  <TeamAvatar />
                ) : (
                  <GitHubAvatar
                    login={rr.login ?? rr.name}
                    size={16}
                  />
                )}
                <span className="text-text-secondary text-[11px] font-medium">
                  {rr.type === "Team" ? rr.name : (rr.login ?? rr.name)}
                </span>
                {rr.asCodeOwner && <CodeOwnerBadge />}
                <ReviewStateBadge state="AWAITING" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Close PR */}
      <div className="flex justify-end px-4 py-3">
        <ConfirmDialog
          trigger={
            <button
              type="button"
              disabled={closeMutation.isPending}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[var(--danger)] px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-[var(--danger)]/80 disabled:opacity-50"
            >
              {closeMutation.isPending ? <Spinner className="h-3 w-3" /> : <XCircle size={11} />}
              Close pull request
            </button>
          }
          title="Close pull request?"
          description={`PR #${prNumber} will be closed. You can reopen it later from GitHub.`}
          confirmLabel="Close PR"
          onConfirm={() => closeMutation.mutate()}
        />
      </div>
    </div>
  );
}

function dedupeReviews(
  reviews: Array<{ author: { login: string }; state: string; submittedAt: string }>,
) {
  const latestByUser = new Map<
    string,
    { author: { login: string }; state: string; submittedAt: string }
  >();
  for (const review of reviews) {
    const existing = latestByUser.get(review.author.login);
    if (!existing || new Date(review.submittedAt) > new Date(existing.submittedAt)) {
      latestByUser.set(review.author.login, review);
    }
  }
  return [...latestByUser.values()];
}

function CodeOwnerBadge() {
  return (
    <span
      className="rounded-sm font-mono text-[9px] font-medium"
      style={{
        padding: "0 5px",
        background: "var(--purple-muted)",
        color: "var(--purple)",
      }}
    >
      CODEOWNER
    </span>
  );
}

function TeamAvatar() {
  return (
    <div
      className="flex items-center justify-center rounded-full"
      style={{
        width: 16,
        height: 16,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        fontSize: "8px",
        color: "var(--text-tertiary)",
      }}
    >
      T
    </div>
  );
}

function ReviewStateBadge({ state }: { state: string }) {
  const config =
    state === "APPROVED"
      ? { text: "Approved", color: "border-success/30 text-success" }
      : state === "CHANGES_REQUESTED"
        ? { text: "Changes Requested", color: "border-destructive/30 text-destructive" }
        : state === "COMMENTED"
          ? { text: "Commented", color: "border-border text-text-tertiary" }
          : state === "DISMISSED"
            ? { text: "Dismissed", color: "border-border text-text-ghost" }
            : state === "PENDING"
              ? { text: "Pending", color: "border-warning/30 text-warning" }
              : state === "AWAITING"
                ? { text: "Awaiting", color: "border-warning/30 text-warning" }
                : { text: state, color: "border-border text-text-tertiary" };

  return (
    <Badge
      variant="outline"
      className={`text-[9px] ${config.color}`}
    >
      {config.text}
    </Badge>
  );
}
