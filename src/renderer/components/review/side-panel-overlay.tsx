/* eslint-disable import/max-dependencies -- The side panel is an intentional composition root for PR detail tabs. */
import type { GhPrDetail, GhPrReactions, GhReviewThread } from "@/shared/ipc";

import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { AiReviewSummary } from "@/renderer/components/review/ai/ai-review-summary";
import { AuthorDossier } from "@/renderer/components/review/author-dossier";
import { ConversationTab } from "@/renderer/components/review/comments/conversation-tab";
import { ReactionBar } from "@/renderer/components/review/comments/reaction-bar";
import { CollapsibleDescription } from "@/renderer/components/shared/collapsible-description";
import { GitHubAvatar } from "@/renderer/components/shared/github-avatar";
import { MarkdownBody } from "@/renderer/components/shared/markdown-body";
import { UserProfileTooltip } from "@/renderer/components/shared/user-profile-tooltip";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, GitMerge, Pencil, X, XCircle } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { PanelChecksContent, PanelCommitsContent } from "./side-panel-tabs";

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
  reviewThreads?: GhReviewThread[];
  reactions?: GhPrReactions;
  canEdit?: boolean;
  /** Panel width in pixels. When provided, overrides the default fixed width. */
  width?: number;
}

export function SidePanelOverlay({
  open,
  onClose,
  pr,
  prNumber,
  issueComments,
  repo,
  onReviewClick,
  diffSnippet,
  activeTab,
  onTabChange,
  reviewThreads,
  reactions,
  canEdit,
  width,
}: SidePanelOverlayProps) {
  const setActiveTab = onTabChange;

  if (!open) {
    return null;
  }

  return (
    <div
      className="bg-bg-surface flex shrink-0 flex-col"
      style={{
        width: width != null ? `${width}px` : "min(380px, 45%)",
        borderLeft: "1px solid var(--border)",
      }}
    >
      {/* Header — 40px, tabs + close */}
      <div
        className="flex shrink-0 items-center"
        style={{
          height: "40px",
          padding: "0 10px",
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
            danger={pr.statusCheckRollup.some((c) => c.conclusion?.toUpperCase() === "FAILURE")}
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
          reviewThreads={reviewThreads}
          repo={repo}
          onReviewClick={onReviewClick}
          issueCommentReactions={reactions?.issueComments}
        />
      ) : (
        <div
          className="flex-1 overflow-y-auto"
          style={{ padding: "14px" }}
        >
          {activeTab === "overview" && (
            <PanelOverviewContent
              pr={pr}
              prNumber={prNumber}
              repo={repo}
              diffSnippet={diffSnippet}
              reactions={reactions}
              canEdit={canEdit}
            />
          )}
          {activeTab === "commits" && <PanelCommitsContent prNumber={prNumber} />}
          {activeTab === "checks" && <PanelChecksContent prNumber={prNumber} />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab — matches mockup's overview-card, labels, reviewers, AI summary
// ---------------------------------------------------------------------------

function PanelOverviewContent({
  pr,
  prNumber,
  repo,
  diffSnippet,
  reactions,
  canEdit,
}: {
  pr: GhPrDetail;
  prNumber: number;
  repo: string;
  diffSnippet: string;
  reactions?: GhPrReactions;
  canEdit?: boolean;
}) {
  const { repoTarget, nwo } = useWorkspace();
  const [editingBody, setEditingBody] = useState(false);
  const [bodyValue, setBodyValue] = useState(pr.body);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const bodyMutation = useMutation({
    mutationFn: (body: string) => ipc("pr.updateBody", { ...repoTarget, prNumber, body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      setEditingBody(false);
      toastManager.add({ title: "Description updated", type: "success" });
    },
    onError: (err: Error) => {
      toastManager.add({
        title: "Failed to update description",
        description: err.message,
        type: "error",
      });
    },
  });

  const startEditingBody = () => {
    setBodyValue(pr.body);
    setEditingBody(true);
  };

  const saveBody = () => {
    if (bodyValue === pr.body) {
      setEditingBody(false);
      return;
    }
    bodyMutation.mutate(bodyValue);
  };

  const reviewRequestsQuery = useQuery({
    queryKey: ["pr", "reviewRequests", nwo, prNumber],
    queryFn: () => ipc("pr.reviewRequests", { ...repoTarget, prNumber }),
  });

  const reviewRequests = reviewRequestsQuery.data ?? [];
  const submittedReviews = dedupeReviews(pr.reviews);
  const submittedLogins = new Set(submittedReviews.map((r) => r.author.login));
  const hasReviewers = submittedReviews.length > 0 || reviewRequests.length > 0;

  return (
    <>
      {/* Author dossier */}
      <AuthorDossier
        login={pr.author.login}
        author={pr.author}
        createdAt={pr.createdAt}
      />

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
          className="flex items-center justify-between"
          style={{ marginBottom: "6px" }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Description
          </div>
          {canEdit && !editingBody && (
            <button
              type="button"
              onClick={startEditingBody}
              className="text-text-ghost hover:text-text-secondary flex cursor-pointer items-center gap-1 transition-colors"
              style={{ fontSize: "10px" }}
            >
              <Pencil size={10} />
              Edit
            </button>
          )}
        </div>
        {editingBody ? (
          <div>
            <textarea
              ref={textareaRef}
              autoFocus
              value={bodyValue}
              onChange={(e) => setBodyValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setEditingBody(false);
                  setBodyValue(pr.body);
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  saveBody();
                }
              }}
              disabled={bodyMutation.isPending}
              rows={8}
              className="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-primary w-full resize-y rounded-md border px-3 py-2 text-xs leading-relaxed focus:outline-none"
              placeholder="Add a description..."
            />
            <div
              className="flex items-center justify-between"
              style={{ marginTop: "6px" }}
            >
              <span className="text-text-ghost text-[10px]">
                {navigator.platform.includes("Mac") ? "Cmd" : "Ctrl"}+Enter to save
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setEditingBody(false);
                    setBodyValue(pr.body);
                  }}
                  disabled={bodyMutation.isPending}
                  className="text-text-tertiary hover:text-text-primary cursor-pointer rounded-sm px-2 py-0.5 text-[11px] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveBody}
                  disabled={bodyMutation.isPending}
                  className="bg-accent-muted text-accent-text hover:bg-accent-muted/80 cursor-pointer rounded-sm px-2.5 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50"
                >
                  {bodyMutation.isPending ? <Spinner className="h-3 w-3" /> : "Save"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
            {pr.body ? (
              <CollapsibleDescription>
                <MarkdownBody
                  content={pr.body}
                  repo={repo}
                />
              </CollapsibleDescription>
            ) : (
              <span
                onClick={canEdit ? startEditingBody : undefined}
                className={
                  canEdit ? "hover:text-text-secondary cursor-pointer transition-colors" : ""
                }
                style={{ fontStyle: "italic" }}
              >
                {canEdit ? "Click to add a description..." : "No description provided."}
              </span>
            )}
          </div>
        )}
        {!editingBody && reactions?.prNodeId && (
          <div style={{ marginTop: "8px" }}>
            <ReactionBar
              reactions={reactions.prBody}
              subjectId={reactions.prNodeId}
              prNumber={prNumber}
            />
          </div>
        )}
      </div>

      {/* Labels */}
      <LabelSection
        repoTarget={repoTarget}
        prNumber={prNumber}
        labels={pr.labels}
      />

      {/* Reviewers */}
      {hasReviewers && (
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
          {/* Submitted reviews */}
          {submittedReviews.map((review) => {
            const request = reviewRequests.find((rr) => rr.login === review.author.login);
            return (
              <div
                key={review.author.login}
                className="flex items-center gap-2"
                style={{ padding: "4px 0", fontSize: "12px" }}
              >
                <UserProfileTooltip login={review.author.login}>
                  <GitHubAvatar
                    login={review.author.login}
                    size={20}
                  />
                </UserProfileTooltip>
                <span className="text-text-primary">{review.author.login}</span>
                {request?.asCodeOwner && (
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
                )}
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
            );
          })}
          {/* Pending requested reviewers (haven't submitted a review yet) */}
          {reviewRequests
            .filter((rr) => !submittedLogins.has(rr.login ?? ""))
            .map((rr) => (
              <div
                key={rr.login ?? rr.name}
                className="flex items-center gap-2"
                style={{ padding: "4px 0", fontSize: "12px" }}
              >
                {rr.type === "Team" ? (
                  <div
                    className="flex items-center justify-center rounded-full"
                    style={{
                      width: 20,
                      height: 20,
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border-strong)",
                      fontSize: "10px",
                      color: "var(--text-tertiary)",
                    }}
                  >
                    T
                  </div>
                ) : (
                  <UserProfileTooltip login={rr.login ?? rr.name}>
                    <GitHubAvatar
                      login={rr.login ?? rr.name}
                      size={20}
                    />
                  </UserProfileTooltip>
                )}
                <span className="text-text-secondary">
                  {rr.type === "Team" ? rr.name : (rr.login ?? rr.name)}
                </span>
                {rr.asCodeOwner && (
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
                )}
                <span
                  className="ml-auto rounded-sm text-[10px] font-medium"
                  style={{
                    padding: "0 6px",
                    background: "var(--warning-muted)",
                    color: "var(--warning)",
                  }}
                >
                  Awaiting
                </span>
              </div>
            ))}
        </div>
      )}

      <AiReviewSummary
        prNumber={prNumber}
        prTitle={pr.title}
        prBody={pr.body}
        author={pr.author.login}
        files={pr.files}
        diffSnippet={diffSnippet}
        variant="card"
      />

      {/* Auto-merge / Merge when ready indicator */}
      {pr.autoMergeRequest && (
        <div
          className="border-info/30 bg-info/5 flex items-center gap-1.5 rounded-md border"
          style={{ padding: "6px 10px", marginTop: "10px" }}
        >
          <GitMerge
            size={12}
            className="text-info"
          />
          <span className="text-info text-[11px] font-medium">Merge when ready</span>
          <span className="text-text-tertiary text-[10px]">
            · {pr.autoMergeRequest.mergeMethod.toLowerCase()} by{" "}
            {pr.autoMergeRequest.enabledBy.login}
          </span>
        </div>
      )}

      {/* Close PR */}
      {pr.state === "OPEN" && (
        <div
          className="flex justify-end"
          style={{ marginTop: "32px" }}
        >
          <button
            type="button"
            onClick={() => closeMutation.mutate()}
            disabled={closeMutation.isPending}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
          >
            {closeMutation.isPending ? <Spinner className="h-3 w-3" /> : <XCircle size={11} />}
            Close pull request
          </button>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Label section with add/remove functionality
// ---------------------------------------------------------------------------

function LabelSection({
  repoTarget,
  prNumber,
  labels,
}: {
  repoTarget: import("@/shared/ipc").RepoTarget;
  prNumber: number;
  labels: Array<{ name: string; color: string }>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const removeLabelMutation = useMutation({
    mutationFn: (label: string) => ipc("pr.removeLabel", { ...repoTarget, prNumber, label }),
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
          repoTarget={repoTarget}
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
  repoTarget,
  prNumber,
  currentLabels,
  onClose,
}: {
  repoTarget: import("@/shared/ipc").RepoTarget;
  prNumber: number;
  currentLabels: string[];
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const labelsQuery = useQuery({
    queryKey: ["repo", "labels", repoTarget.owner, repoTarget.repo],
    queryFn: () => ipc("pr.repoLabels", { ...repoTarget }),
    staleTime: 60_000,
  });

  const addLabelMutation = useMutation({
    mutationFn: (label: string) => ipc("pr.addLabel", { ...repoTarget, prNumber, label }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr", "detail"] });
    },
  });

  const removeLabelMutation = useMutation({
    mutationFn: (label: string) => ipc("pr.removeLabel", { ...repoTarget, prNumber, label }),
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
        height: "40px",
        fontSize: "12px",
        fontWeight: active ? 500 : 450,
        color: active ? "var(--text-primary)" : "var(--text-tertiary)",
        borderBottom: active ? "1.5px solid var(--accent)" : "1.5px solid transparent",
      }}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span
          className="inline-flex items-center justify-center font-mono leading-none"
          style={{
            fontSize: "9px",
            height: "16px",
            minWidth: "16px",
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
