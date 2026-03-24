import type { GhPrDetail } from "@/shared/ipc";

import { Spinner } from "@/components/ui/spinner";
import { relativeTime } from "@/shared/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2, X, XCircle } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { ipc } from "../lib/ipc";
import { summarizePrChecks } from "../lib/pr-check-status";
import { queryClient } from "../lib/query-client";
import { useRouter } from "../lib/router";
import { useWorkspace } from "../lib/workspace-context";
import { ConversationTab } from "./conversation-tab";
import { GitHubAvatar } from "./github-avatar";
import { MarkdownBody } from "./markdown-body";

/**
 * Side panel overlay — PR-REVIEW-REDESIGN.md § Side Panel
 *
 * 380px overlay that slides from right with backdrop.
 * Tabs: Overview, Conversation, Commits, Checks
 */

export type PanelTab = "overview" | "conversation" | "commits" | "checks";

interface SidePanelOverlayProps {
  open: boolean;
  onClose: () => void;
  pr: GhPrDetail;
  prNumber: number;
  issueComments: Array<{ id: string; body: string; author: { login: string }; createdAt: string }>;
  repo: string;
  highlightedLogin: string | null;
  onReviewClick: (login: string) => void;
  diffSnippet: string;
  activeTab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
}

export function SidePanelOverlay({
  open,
  onClose,
  pr,
  prNumber,
  issueComments,
  repo,
  onReviewClick,
  activeTab,
  onTabChange,
}: SidePanelOverlayProps) {
  const setActiveTab = onTabChange;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 z-[4] transition-opacity duration-[400ms] ease-out ${
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        style={{ background: "rgba(0,0,0,0.25)" }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`bg-bg-surface absolute top-0 right-0 bottom-0 z-[5] flex w-[380px] flex-col transition-transform duration-[400ms] ${
          open ? "pointer-events-auto translate-x-0" : "pointer-events-none translate-x-full"
        }`}
        style={{
          borderLeft: "1px solid var(--border)",
          boxShadow: open ? "-4px 0 24px rgba(0,0,0,0.4)" : "none",
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Header — 36px, tabs + close */}
        <div
          className="flex shrink-0 items-center"
          style={{
            height: "36px",
            padding: "0 8px",
            borderBottom: "1px solid var(--border)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }}
        >
          <div className="flex flex-1 gap-0">
            <PanelTabButton
              label="Overview"
              active={activeTab === "overview"}
              onClick={() => setActiveTab("overview")}
            />
            <PanelTabButton
              label="Conversation"
              count={issueComments.length + pr.reviews.length}
              active={activeTab === "conversation"}
              onClick={() => setActiveTab("conversation")}
            />
            <PanelTabButton
              label="Commits"
              active={activeTab === "commits"}
              onClick={() => setActiveTab("commits")}
            />
            <PanelTabButton
              label="Checks"
              count={pr.statusCheckRollup.length}
              active={activeTab === "checks"}
              onClick={() => setActiveTab("checks")}
              danger={pr.statusCheckRollup.some((c) => c.conclusion === "failure")}
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-ghost hover:text-text-primary hover:bg-bg-raised flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Conversation tab manages its own scroll + composer */}
        {activeTab === "conversation" ? (
          <ConversationTab
            prNumber={prNumber}
            reviews={pr.reviews}
            issueComments={issueComments}
            reviewThreads={pr.reviewThreads}
            repo={repo}
            onReviewClick={onReviewClick}
          />
        ) : (
          <div
            className="flex-1 overflow-y-auto"
            style={{ padding: "12px" }}
          >
            {activeTab === "overview" && (
              <PanelOverviewContent
                pr={pr}
                prNumber={prNumber}
                repo={repo}
              />
            )}
            {activeTab === "commits" && <PanelCommitsContent prNumber={prNumber} />}
            {activeTab === "checks" && <PanelChecksContent prNumber={prNumber} />}
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Overview tab — matches mockup's overview-card, labels, reviewers, AI summary
// ---------------------------------------------------------------------------

function PanelOverviewContent({
  pr,
  prNumber,
  repo,
}: {
  pr: GhPrDetail;
  prNumber: number;
  repo: string;
}) {
  const { cwd } = useWorkspace();

  return (
    <>
      {/* Description card */}
      <div
        style={{
          background: "var(--bg-raised)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: "10px 12px",
          marginBottom: "10px",
        }}
      >
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--text-tertiary)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: "6px",
          }}
        >
          Description
        </div>
        <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
          {pr.body ? (
            <MarkdownBody
              content={pr.body}
              repo={repo}
            />
          ) : (
            <span style={{ fontStyle: "italic" }}>No description provided.</span>
          )}
        </div>
      </div>

      {/* Labels */}
      <LabelSection
        cwd={cwd}
        prNumber={prNumber}
        labels={pr.labels}
      />

      {/* Reviewers */}
      {pr.reviews.length > 0 && (
        <div style={{ marginBottom: "12px" }}>
          <div
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: "6px",
            }}
          >
            Reviewers
          </div>
          {dedupeReviews(pr.reviews).map((review) => (
            <div
              key={review.author.login}
              className="flex items-center gap-2"
              style={{ padding: "4px 0", fontSize: "12px" }}
            >
              <GitHubAvatar
                login={review.author.login}
                size={20}
              />
              <span>{review.author.login}</span>
              <span
                className="ml-auto rounded-sm text-[10px] font-medium"
                style={{
                  padding: "0 6px",
                  background:
                    review.state === "APPROVED"
                      ? "var(--success-muted)"
                      : review.state === "CHANGES_REQUESTED"
                        ? "var(--danger-muted)"
                        : "var(--warning-muted)",
                  color:
                    review.state === "APPROVED"
                      ? "var(--success)"
                      : review.state === "CHANGES_REQUESTED"
                        ? "var(--danger)"
                        : "var(--warning)",
                }}
              >
                {review.state === "APPROVED"
                  ? "Approved"
                  : review.state === "CHANGES_REQUESTED"
                    ? "Changes"
                    : "Pending"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* AI Summary card */}
      <div
        style={{
          background: "var(--bg-raised)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
          marginTop: "10px",
        }}
      >
        <div
          className="text-accent-text hover:bg-bg-elevated flex cursor-pointer items-center gap-1.5 select-none"
          style={{
            padding: "8px 10px",
            fontSize: "11px",
            fontWeight: 500,
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
          </svg>
          AI Summary
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Label section with add/remove functionality
// ---------------------------------------------------------------------------

function LabelSection({
  cwd,
  prNumber,
  labels,
}: {
  cwd: string;
  prNumber: number;
  labels: Array<{ name: string; color: string }>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const removeLabelMutation = useMutation({
    mutationFn: (label: string) => ipc("pr.removeLabel", { cwd, prNumber, label }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr", "detail"] });
    },
  });

  return (
    <div
      ref={containerRef}
      style={{ marginBottom: "12px", position: "relative" }}
    >
      <div
        style={{
          fontSize: "10px",
          fontWeight: 600,
          color: "var(--text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: "6px",
        }}
      >
        Labels
      </div>
      <div className="flex flex-wrap gap-1">
        {labels.map((label) => (
          <span
            key={label.name}
            className="group"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "1px 8px",
              borderRadius: "var(--radius-full)",
              fontSize: "10px",
              fontWeight: 500,
              background: `#${label.color}20`,
              color: `#${label.color}`,
              marginRight: "4px",
              marginBottom: "4px",
            }}
          >
            {label.name}
            <button
              type="button"
              onClick={() => removeLabelMutation.mutate(label.name)}
              className="hidden cursor-pointer items-center justify-center rounded-full opacity-60 transition-opacity group-hover:inline-flex hover:opacity-100"
              style={{ width: "12px", height: "12px" }}
            >
              <X size={8} />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setPickerOpen(!pickerOpen)}
          style={{
            display: "inline-flex",
            padding: "1px 8px",
            borderRadius: "var(--radius-full)",
            fontSize: "10px",
            fontWeight: 500,
            background: pickerOpen ? "var(--bg-raised)" : "var(--bg-elevated)",
            color: "var(--text-ghost)",
            border: `1px dashed ${pickerOpen ? "var(--accent)" : "var(--border-strong)"}`,
            cursor: "pointer",
          }}
        >
          + Add
        </button>
      </div>
      {pickerOpen && (
        <LabelPicker
          cwd={cwd}
          prNumber={prNumber}
          currentLabels={labels.map((l) => l.name)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Label picker dropdown
// ---------------------------------------------------------------------------

function LabelPicker({
  cwd,
  prNumber,
  currentLabels,
  onClose,
}: {
  cwd: string;
  prNumber: number;
  currentLabels: string[];
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const labelsQuery = useQuery({
    queryKey: ["repo", "labels", cwd],
    queryFn: () => ipc("pr.repoLabels", { cwd }),
    staleTime: 60_000,
  });

  const addLabelMutation = useMutation({
    mutationFn: (label: string) => ipc("pr.addLabel", { cwd, prNumber, label }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr", "detail"] });
    },
  });

  const removeLabelMutation = useMutation({
    mutationFn: (label: string) => ipc("pr.removeLabel", { cwd, prNumber, label }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr", "detail"] });
    },
  });

  const allLabels = labelsQuery.data ?? [];
  const filtered = allLabels.filter((l) => l.name.toLowerCase().includes(search.toLowerCase()));

  const handleToggle = useCallback(
    (labelName: string) => {
      if (currentLabels.includes(labelName)) {
        removeLabelMutation.mutate(labelName);
      } else {
        addLabelMutation.mutate(labelName);
      }
    },
    [currentLabels, addLabelMutation, removeLabelMutation],
  );

  // Close on click outside
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <>
      <div
        className="fixed inset-0 z-[9]"
        onClick={handleBackdropClick}
      />
      <div
        ref={pickerRef}
        style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          marginTop: "4px",
          zIndex: 10,
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "6px" }}>
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter labels..."
            style={{
              width: "100%",
              padding: "4px 8px",
              fontSize: "11px",
              background: "var(--bg-raised)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              color: "var(--text-primary)",
              outline: "none",
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onClose();
              }
            }}
          />
        </div>
        <div style={{ maxHeight: "200px", overflowY: "auto", padding: "0 4px 4px" }}>
          {labelsQuery.isLoading && (
            <div className="flex items-center justify-center py-4">
              <Spinner className="text-primary h-3 w-3" />
            </div>
          )}
          {filtered.length === 0 && !labelsQuery.isLoading && (
            <div
              style={{
                padding: "8px",
                fontSize: "11px",
                color: "var(--text-tertiary)",
                textAlign: "center",
              }}
            >
              No labels found
            </div>
          )}
          {filtered.map((label) => {
            const isActive = currentLabels.includes(label.name);
            return (
              <button
                key={label.name}
                type="button"
                onClick={() => handleToggle(label.name)}
                className="hover:bg-bg-raised flex w-full cursor-pointer items-center gap-2 rounded-sm transition-colors"
                style={{ padding: "5px 6px", fontSize: "11px" }}
              >
                <span
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "var(--radius-full)",
                    background: `#${label.color}`,
                    flexShrink: 0,
                  }}
                />
                <span
                  className="min-w-0 flex-1 truncate text-left"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {label.name}
                </span>
                {isActive && (
                  <Check
                    size={12}
                    style={{ color: "var(--success)", flexShrink: 0 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
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

// ---------------------------------------------------------------------------
// Commits tab — SHA pill + message + author · time
// ---------------------------------------------------------------------------

function PanelCommitsContent({ prNumber }: { prNumber: number }) {
  const { cwd } = useWorkspace();

  const commitsQuery = useQuery({
    queryKey: ["pr", "commits", cwd, prNumber],
    queryFn: () => ipc("pr.commits", { cwd, prNumber }),
    staleTime: 60_000,
  });

  const commits = commitsQuery.data ?? [];

  if (commitsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="text-primary h-4 w-4" />
      </div>
    );
  }

  if (commits.length === 0) {
    return <p className="text-text-tertiary text-xs">No commits.</p>;
  }

  return (
    <div>
      {commits.map((commit, i) => (
        <div
          key={commit.oid}
          className="flex items-start gap-2"
          style={{
            padding: "8px 0",
            borderBottom: i < commits.length - 1 ? "1px solid var(--border-subtle)" : "none",
          }}
        >
          <span
            className="text-info bg-info-muted shrink-0 rounded-sm font-mono text-[10px]"
            style={{ padding: "1px 5px" }}
          >
            {commit.oid.slice(0, 7)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-text-primary text-xs">{commit.message.split("\n")[0]}</div>
            <div className="text-text-tertiary mt-0.5 text-[10px]">
              {commit.author} · {relativeTime(new Date(commit.committedDate))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checks tab — summary + flat item list (compact, matching mockup)
// ---------------------------------------------------------------------------

/** Extract the GitHub Actions run ID from a check's detailsUrl. */
function parseRunIdFromUrl(detailsUrl: string): number | null {
  const match = detailsUrl.match(/\/actions\/runs\/(\d+)/);
  return match?.[1] ? Number(match[1]) : null;
}

function PanelChecksContent({ prNumber }: { prNumber: number }) {
  const { cwd } = useWorkspace();
  const { navigate } = useRouter();

  const checksQuery = useQuery({
    queryKey: ["checks", "list", cwd, prNumber],
    queryFn: () => ipc("checks.list", { cwd, prNumber }),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const checks = checksQuery.data ?? [];
  const summary = useMemo(() => summarizePrChecks(checks), [checks]);

  if (checksQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="text-primary h-4 w-4" />
      </div>
    );
  }

  if (checks.length === 0) {
    return (
      <div className="py-4 text-center">
        <span className="text-text-tertiary text-xs">No CI checks configured</span>
      </div>
    );
  }

  return (
    <div>
      {/* Summary line */}
      <div
        className="flex items-center gap-[5px] font-medium"
        style={{
          padding: "6px 0 10px",
          fontSize: "12px",
          color: summary.failed > 0 ? "var(--danger)" : "var(--success)",
        }}
      >
        {summary.failed > 0 ? <XCircle size={13} /> : <Check size={13} />}
        {summary.failed > 0
          ? `${summary.failed} failed, ${summary.passed} passed`
          : `${summary.passed} passed`}
      </div>

      {/* Check items */}
      {checks.map((check, i) => {
        const failed = check.conclusion === "failure";
        const pending = !check.conclusion;
        const duration =
          check.completedAt && check.startedAt
            ? formatDuration(
                new Date(check.completedAt).getTime() - new Date(check.startedAt).getTime(),
              )
            : "—";
        const runId = parseRunIdFromUrl(check.detailsUrl);

        return (
          <button
            key={check.name}
            type="button"
            onClick={() => {
              if (runId) {
                navigate({ view: "workflows", runId, fromPr: prNumber });
              }
            }}
            className="hover:bg-bg-raised flex w-full cursor-pointer items-center gap-1.5 rounded-sm transition-colors"
            style={{
              padding: "5px 4px",
              borderBottom: i < checks.length - 1 ? "1px solid var(--border-subtle)" : "none",
              fontSize: "12px",
            }}
          >
            <span
              className="shrink-0"
              style={{
                color: failed ? "var(--danger)" : pending ? "var(--warning)" : "var(--success)",
              }}
            >
              {failed ? (
                <XCircle size={12} />
              ) : pending ? (
                <Loader2
                  size={12}
                  className="animate-spin"
                />
              ) : (
                <Check size={12} />
              )}
            </span>
            <span
              className="min-w-0 flex-1 truncate text-left"
              style={{ color: "var(--text-secondary)" }}
            >
              {check.name}
            </span>
            <span
              className="font-mono"
              style={{ fontSize: "10px", color: "var(--text-tertiary)" }}
            >
              {duration}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

// ---------------------------------------------------------------------------
// Tab button
// ---------------------------------------------------------------------------

function PanelTabButton({
  label,
  count,
  active,
  onClick,
  danger,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center gap-[5px] select-none"
      style={{
        padding: "0 10px",
        height: "36px",
        fontSize: "12px",
        fontWeight: active ? 500 : 450,
        color: active ? "var(--text-primary)" : "var(--text-tertiary)",
        borderBottom: active ? "1.5px solid var(--accent)" : "1.5px solid transparent",
      }}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span
          className="font-mono"
          style={{
            fontSize: "9px",
            padding: "0 4px",
            borderRadius: "3px",
            background: danger ? "var(--danger-muted)" : "var(--bg-raised)",
            color: danger ? "var(--danger)" : "var(--text-tertiary)",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
