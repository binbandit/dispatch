import type { DiffFile } from "../lib/diff-parser";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { relativeTime } from "@/shared/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, GitMerge } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { parseDiff } from "../lib/diff-parser";
import { queryClient, trpc } from "../lib/trpc";
import { useWorkspace } from "../lib/workspace-context";
import { ChecksPanel } from "./checks-panel";
import { DiffViewer } from "./diff-viewer";
import { FileTree } from "./file-tree";

/**
 * PR detail view — DISPATCH-DESIGN-SYSTEM.md § 8.5, 8.6, 8.7, 8.8
 */

interface PrDetailViewProps {
  prNumber: number | null;
}

export function PrDetailView({ prNumber }: PrDetailViewProps) {
  if (!prNumber) {
    return <EmptyState />;
  }

  return <PrDetail prNumber={prNumber} />;
}

// ---------------------------------------------------------------------------
// Main PR detail (with data)
// ---------------------------------------------------------------------------

function PrDetail({ prNumber }: { prNumber: number }) {
  const { cwd } = useWorkspace();
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<"checks" | "reviews" | "files">("files");

  // PR detail query
  const detailQuery = useQuery({
    ...trpc.pr.detail.queryOptions({ cwd, prNumber }),
    refetchInterval: 60_000,
  });

  // PR diff query
  const diffQuery = useQuery({
    ...trpc.pr.diff.queryOptions({ cwd, prNumber }),
    staleTime: 60_000,
  });

  // Viewed files
  const repoName = cwd.split("/").pop() ?? "";
  const viewedQuery = useQuery(trpc.review.viewedFiles.queryOptions({ repo: repoName, prNumber }));
  const viewedFiles = useMemo(() => new Set(viewedQuery.data ?? []), [viewedQuery.data]);

  const setViewedMutation = useMutation(
    trpc.review.setFileViewed.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["review", "viewedFiles"] });
      },
    }),
  );

  // Parse diff
  const files: DiffFile[] = useMemo(() => {
    if (!diffQuery.data) {
      return [];
    }
    return parseDiff(diffQuery.data);
  }, [diffQuery.data]);

  const currentFile = files[currentFileIndex] ?? null;

  // File navigation
  const goToPrevFile = useCallback(() => {
    setCurrentFileIndex((i) => Math.max(0, i - 1));
  }, []);

  const goToNextFile = useCallback(() => {
    setCurrentFileIndex((i) => Math.min(files.length - 1, i + 1));
  }, [files.length]);

  // Keyboard: [ and ] for file navigation
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      if (e.key === "[") {
        goToPrevFile();
      } else if (e.key === "]") {
        goToNextFile();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [goToPrevFile, goToNextFile]);

  // Loading state
  if (detailQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="text-primary h-5 w-5" />
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-destructive text-sm">Failed to load PR #{prNumber}</p>
      </div>
    );
  }

  const pr = detailQuery.data;
  const totalAdditions = pr.files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = pr.files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* PR Header (§ 8.5) */}
      <div className="border-border bg-bg-surface flex items-center gap-3 border-b px-5 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-text-primary text-base font-semibold tracking-[-0.02em]">
            {pr.title} <span className="text-text-tertiary font-normal">#{pr.number}</span>
          </h1>
          <div className="text-text-secondary mt-0.5 flex items-center gap-1.5 text-xs">
            <Badge
              variant="outline"
              className="border-border bg-bg-raised text-accent-text rounded-sm font-mono text-[11px]"
            >
              {pr.headRefName}
            </Badge>
            <span className="text-text-tertiary">→</span>
            <span className="text-text-tertiary font-mono text-[11px]">{pr.baseRefName}</span>
            <span className="text-text-ghost">·</span>
            <span>{pr.author.login}</span>
            <span className="text-text-ghost">·</span>
            <span>{relativeTime(new Date(pr.updatedAt))}</span>
            <span className="text-text-ghost">·</span>
            <span className="text-success font-mono text-[11px]">+{totalAdditions}</span>
            <span className="text-destructive font-mono text-[11px]">-{totalDeletions}</span>
          </div>
        </div>
        <MergeButton
          cwd={cwd}
          prNumber={prNumber}
          pr={pr}
        />
      </div>

      {/* Diff viewer + side panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Diff content area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Toolbar (§ 8.6) */}
          <DiffToolbar
            currentFile={currentFile}
            currentIndex={currentFileIndex}
            totalFiles={files.length}
            onPrev={goToPrevFile}
            onNext={goToNextFile}
          />

          {/* Diff viewer */}
          {diffQuery.isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Spinner className="text-primary h-4 w-4" />
            </div>
          ) : currentFile ? (
            <DiffViewer file={currentFile} />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-text-tertiary text-xs">No files changed</p>
            </div>
          )}
        </div>

        {/* Side panel (§ 8.7) — 320px */}
        <aside className="border-border bg-bg-surface flex w-[320px] shrink-0 flex-col border-l">
          {/* Tabs */}
          <div className="border-border flex border-b px-3 pt-2.5">
            <TabButton
              label="Files"
              count={files.length}
              active={activeTab === "files"}
              onClick={() => setActiveTab("files")}
            />
            <TabButton
              label="Checks"
              count={pr.statusCheckRollup.length}
              active={activeTab === "checks"}
              onClick={() => setActiveTab("checks")}
            />
            <TabButton
              label="Reviews"
              count={pr.reviews.length}
              active={activeTab === "reviews"}
              onClick={() => setActiveTab("reviews")}
            />
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === "files" && (
              <div className="p-2">
                <FileTree
                  files={files}
                  currentFileIndex={currentFileIndex}
                  onSelectFile={setCurrentFileIndex}
                  viewedFiles={viewedFiles}
                  onToggleViewed={(filePath, viewed) => {
                    setViewedMutation.mutate({
                      repo: repoName,
                      prNumber,
                      filePath,
                      viewed,
                    });
                  }}
                />
              </div>
            )}
            {activeTab === "checks" && <ChecksPanel prNumber={prNumber} />}
            {activeTab === "reviews" && <ReviewsList reviews={pr.reviews} />}
          </div>

          {/* Merge panel (§ 8.8) */}
          <MergeChecklist pr={pr} />
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3">
      <h2 className="font-heading text-text-primary text-3xl italic">Select a pull request</h2>
      <p className="text-text-secondary max-w-xs text-center text-[13px]">
        Choose a PR from the sidebar to start reviewing. Use{" "}
        <kbd className="border-border-strong bg-bg-raised text-text-secondary rounded-xs border px-1 py-0.5 font-mono text-[10px] font-medium shadow-[0_1px_0_var(--border)]">
          j
        </kbd>
        /
        <kbd className="border-border-strong bg-bg-raised text-text-secondary rounded-xs border px-1 py-0.5 font-mono text-[10px] font-medium shadow-[0_1px_0_var(--border)]">
          k
        </kbd>{" "}
        to navigate.
      </p>
    </div>
  );
}

function DiffToolbar({
  currentFile,
  currentIndex,
  totalFiles,
  onPrev,
  onNext,
}: {
  currentFile: DiffFile | null;
  currentIndex: number;
  totalFiles: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const filePath = currentFile?.newPath ?? currentFile?.oldPath ?? "";
  const fileName = filePath.split("/").pop() ?? "";
  const dirPath = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/") + 1) : "";

  return (
    <div className="border-border-subtle bg-bg-surface flex h-[38px] shrink-0 items-center gap-2 border-b px-3">
      <button
        type="button"
        onClick={onPrev}
        disabled={currentIndex === 0}
        className="text-text-secondary hover:bg-bg-raised hover:text-text-primary flex h-6 w-6 items-center justify-center rounded-sm disabled:opacity-30"
      >
        <ChevronLeft size={13} />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={currentIndex >= totalFiles - 1}
        className="text-text-secondary hover:bg-bg-raised hover:text-text-primary flex h-6 w-6 items-center justify-center rounded-sm disabled:opacity-30"
      >
        <ChevronRight size={13} />
      </button>

      <span className="text-text-tertiary font-mono text-xs">
        {dirPath}
        <span className="text-text-primary font-medium">{fileName}</span>
      </span>

      <div className="flex-1" />

      {currentFile && (
        <>
          <span className="text-success font-mono text-[11px]">+{currentFile.additions}</span>
          <span className="text-destructive font-mono text-[11px]">-{currentFile.deletions}</span>
        </>
      )}

      {totalFiles > 0 && (
        <div className="flex items-center gap-1.5">
          <div className="bg-border h-[3px] w-[60px] overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all"
              style={{ width: `${((currentIndex + 1) / totalFiles) * 100}%` }}
            />
          </div>
          <span className="text-text-tertiary font-mono text-[10px]">
            {currentIndex + 1}/{totalFiles}
          </span>
        </div>
      )}
    </div>
  );
}

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-3 pb-2.5 text-xs ${
        active
          ? "text-text-primary font-medium"
          : "text-text-secondary hover:text-text-primary font-[450]"
      }`}
    >
      {label}
      <span className="text-text-tertiary ml-1 font-mono text-[10px]">{count}</span>
      {active && (
        <div className="bg-primary absolute bottom-0 left-1/2 h-[1.5px] w-4 -translate-x-1/2 rounded-[1px]" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Reviews list
// ---------------------------------------------------------------------------

function ReviewsList({
  reviews,
}: {
  reviews: Array<{ author: { login: string }; state: string; submittedAt: string }>;
}) {
  if (reviews.length === 0) {
    return <div className="text-text-tertiary px-3 py-4 text-center text-xs">No reviews yet</div>;
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {reviews.map((review, i) => (
        <div
          key={`${review.author.login}-${review.submittedAt}-${i}`}
          className="flex items-center gap-2 rounded-md px-2 py-1.5"
        >
          {/* Avatar */}
          <div
            className="text-bg-root flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold"
            style={{ background: "linear-gradient(135deg, var(--primary), #7c5a2a)" }}
          >
            {review.author.login[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-text-primary text-xs font-medium">{review.author.login}</span>
          </div>
          <Badge
            variant="outline"
            className={`text-[10px] ${
              review.state === "APPROVED"
                ? "border-success/30 text-success"
                : review.state === "CHANGES_REQUESTED"
                  ? "border-destructive/30 text-destructive"
                  : "border-border text-text-tertiary"
            }`}
          >
            {review.state === "APPROVED"
              ? "Approved"
              : review.state === "CHANGES_REQUESTED"
                ? "Changes"
                : review.state === "COMMENTED"
                  ? "Commented"
                  : review.state}
          </Badge>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Merge checklist (§ 8.8)
// ---------------------------------------------------------------------------

function MergeChecklist({
  pr,
}: {
  pr: {
    reviewDecision: string;
    mergeable: string;
    statusCheckRollup: Array<{ conclusion: string | null }>;
  };
}) {
  const hasApproval = pr.reviewDecision === "APPROVED";
  const allChecksPassing = pr.statusCheckRollup.every((c) => c.conclusion === "success");
  const noConflicts = pr.mergeable === "MERGEABLE";

  return (
    <div className="border-border bg-bg-raised border-t p-3">
      <div className="flex flex-col gap-1.5">
        <ChecklistItem
          label="Review approved"
          passed={hasApproval}
        />
        <ChecklistItem
          label="CI checks passing"
          passed={allChecksPassing}
        />
        <ChecklistItem
          label={pr.mergeable === "CONFLICTING" ? "Merge conflicts" : "No merge conflicts"}
          passed={noConflicts}
        />
      </div>
    </div>
  );
}

function ChecklistItem({ label, passed }: { label: string; passed: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`flex h-[13px] w-[13px] items-center justify-center text-[10px] ${
          passed ? "text-success" : "text-destructive"
        }`}
      >
        {passed ? "✓" : "✕"}
      </span>
      <span className={`text-[11px] ${passed ? "text-text-secondary" : "text-destructive"}`}>
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Merge button (§ 8.8)
// ---------------------------------------------------------------------------

function MergeButton({
  cwd,
  prNumber,
  pr,
}: {
  cwd: string;
  prNumber: number;
  pr: {
    reviewDecision: string;
    mergeable: string;
    statusCheckRollup: Array<{ conclusion: string | null }>;
  };
}) {
  const [strategy, _setStrategy] = useState<"squash" | "merge" | "rebase">("squash");

  const mergeMutation = useMutation(
    trpc.pr.merge.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["pr"] });
      },
    }),
  );

  const hasApproval = pr.reviewDecision === "APPROVED";
  const allChecksPassing = pr.statusCheckRollup.every((c) => c.conclusion === "success");
  const canMerge = hasApproval && allChecksPassing && pr.mergeable === "MERGEABLE";

  return (
    <Button
      size="sm"
      className="bg-primary text-primary-foreground hover:bg-accent-hover gap-1.5 disabled:opacity-50"
      disabled={!canMerge || mergeMutation.isPending}
      onClick={() => {
        mergeMutation.mutate({ cwd, prNumber, strategy });
      }}
    >
      {mergeMutation.isPending ? <Spinner className="h-3 w-3" /> : <GitMerge size={13} />}
      Merge
    </Button>
  );
}
