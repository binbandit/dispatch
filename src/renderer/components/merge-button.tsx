import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, GitMerge, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ipc } from "../lib/ipc";
import { summarizePrChecks } from "../lib/pr-check-status";
import { queryClient } from "../lib/query-client";

/**
 * Merge button — DISPATCH-DESIGN-SYSTEM.md § 8.8
 *
 * When the repo uses a merge queue, shows "Merge when ready" as the primary action.
 * Otherwise, shows a split button with strategy selection (squash, merge, rebase).
 * Supports merge queue status display and admin override in both modes.
 */

const STRATEGY_LABELS: Record<string, string> = {
  squash: "Squash & Merge",
  merge: "Merge",
  rebase: "Rebase & Merge",
};

export function MergeButton({
  cwd,
  prNumber,
  pr,
  canAdmin,
  hasMergeQueue,
}: {
  cwd: string;
  prNumber: number;
  pr: {
    reviewDecision: string;
    mergeable: string;
    mergeStateStatus: string;
    statusCheckRollup: Array<{ conclusion: string | null }>;
    autoMergeRequest: {
      enabledBy: { login: string };
      mergeMethod: string;
    } | null;
  };
  canAdmin: boolean;
  hasMergeQueue: boolean;
}) {
  const [strategy, setStrategy] = useState<"squash" | "merge" | "rebase">("squash");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Merge queue status
  const queueQuery = useQuery({
    queryKey: ["pr", "mergeQueueStatus", cwd, prNumber],
    queryFn: () => ipc("pr.mergeQueueStatus", { cwd, prNumber }),
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  const queueStatus = queueQuery.data;

  const mergeMutation = useMutation({
    mutationFn: (args: {
      cwd: string;
      prNumber: number;
      strategy: "merge" | "squash" | "rebase";
      admin?: boolean;
      auto?: boolean;
    }) => ipc("pr.merge", args),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      if (result.queued) {
        toastManager.add({
          title: `PR #${prNumber} added to merge queue`,
          type: "success",
        });
      } else {
        toastManager.add({
          title: `PR #${prNumber} merged`,
          description: "Branch deleted.",
          type: "success",
        });
      }
    },
    onError: (err) => {
      toastManager.add({
        title: "Merge failed",
        description: String(err.message),
        type: "error",
      });
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => ipc("pr.close", { cwd, prNumber }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      toastManager.add({
        title: `PR #${prNumber} closed`,
        type: "success",
      });
    },
    onError: (err) => {
      toastManager.add({
        title: "Close failed",
        description: String(err.message),
        type: "error",
      });
    },
  });

  const updateBranchMutation = useMutation({
    mutationFn: () => ipc("pr.updateBranch", { cwd, prNumber }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      toastManager.add({ title: "Branch updated", type: "success" });
    },
    onError: (err) => {
      toastManager.add({
        title: "Update failed",
        description: String(err.message),
        type: "error",
      });
    },
  });

  const hasApproval = pr.reviewDecision === "APPROVED";
  const checkSummary = summarizePrChecks(pr.statusCheckRollup);
  const allChecksPassing =
    checkSummary.failed === 0 && checkSummary.pending === 0 && checkSummary.total > 0;
  const requirementsMet = hasApproval && allChecksPassing && pr.mergeable === "MERGEABLE";
  const canMerge = requirementsMet || canAdmin;
  const isBehind = pr.mergeStateStatus === "BEHIND";

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  // If in merge queue, show queue status instead of merge button
  if (queueStatus?.inQueue) {
    return (
      <div className="flex items-center gap-2">
        <div className="border-info/30 bg-info/5 flex items-center gap-1.5 rounded-md border px-3 py-1.5">
          <GitMerge
            size={13}
            className="text-info"
          />
          <span className="text-info text-xs font-medium">
            In merge queue
            {queueStatus.position !== null && ` · #${queueStatus.position + 1}`}
          </span>
          {queueStatus.estimatedTimeToMerge !== null && (
            <span className="text-text-tertiary text-[10px]">
              ~{Math.ceil(queueStatus.estimatedTimeToMerge / 60)}min
            </span>
          )}
        </div>
        {canAdmin && (
          <Button
            size="sm"
            variant="ghost"
            className="text-warning hover:text-warning gap-1 text-[10px]"
            onClick={() => mergeMutation.mutate({ cwd, prNumber, strategy, admin: true })}
            disabled={mergeMutation.isPending}
          >
            Skip queue
          </Button>
        )}
      </div>
    );
  }

  // Merge queue mode: single "Merge when ready" button with dropdown for close / admin override
  if (hasMergeQueue) {
    return (
      <div
        ref={menuRef}
        className="relative flex items-center gap-1.5"
      >
        <div className="flex">
          <Button
            size="sm"
            variant={!requirementsMet ? "outline" : "success"}
            className={`gap-1.5 ${canAdmin ? "rounded-r-none" : ""} ${
              !requirementsMet ? "disabled:opacity-100" : ""
            }`}
            disabled={!requirementsMet || mergeMutation.isPending}
            onClick={() => {
              mergeMutation.mutate({
                cwd,
                prNumber,
                strategy: "squash",
                auto: true,
              });
            }}
          >
            {mergeMutation.isPending ? <Spinner className="h-3 w-3" /> : <GitMerge size={13} />}
            Merge when ready
          </Button>
          {canAdmin && (
            <Button
              size="sm"
              variant={!requirementsMet ? "outline" : "success"}
              className={`rounded-l-none border-l px-1.5 ${
                !requirementsMet
                  ? "disabled:opacity-100"
                  : "border-l-[#08080a]/20"
              }`}
              disabled={mergeMutation.isPending || closeMutation.isPending}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <ChevronDown size={12} />
            </Button>
          )}
        </div>

        {menuOpen && (
          <div className="border-border bg-bg-elevated absolute top-full right-0 z-20 mt-1 w-48 rounded-md border p-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                mergeMutation.mutate({ cwd, prNumber, strategy: "squash", admin: true });
              }}
              disabled={mergeMutation.isPending}
              className="text-warning hover:bg-warning/10 flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-3 py-1.5 text-left text-xs transition-colors"
            >
              <ShieldAlert size={12} />
              Merge now (admin)
            </button>
            <div className="bg-border my-1 h-px" />
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                closeMutation.mutate();
              }}
              disabled={closeMutation.isPending}
              className="text-destructive hover:bg-destructive/10 flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-3 py-1.5 text-left text-xs transition-colors"
            >
              <XCircle size={12} />
              Close pull request
            </button>
          </div>
        )}

        {/* Update branch button */}
        {isBehind && (
          <Button
            size="sm"
            variant="ghost"
            className="text-warning hover:text-warning gap-1 text-[10px]"
            onClick={() => updateBranchMutation.mutate()}
            disabled={updateBranchMutation.isPending}
          >
            {updateBranchMutation.isPending ? (
              <Spinner className="h-2.5 w-2.5" />
            ) : (
              <RefreshCw size={10} />
            )}
            Update branch
          </Button>
        )}

        {/* Auto-merge indicator */}
        {pr.autoMergeRequest && (
          <div className="border-info/30 bg-info/5 flex items-center gap-1 rounded-md border px-2 py-1">
            <GitMerge
              size={11}
              className="text-info"
            />
            <span className="text-info text-[10px] font-medium">Auto-merge</span>
          </div>
        )}
      </div>
    );
  }

  // Standard mode: split button with strategy selection
  return (
    <div
      ref={menuRef}
      className="relative flex items-center gap-1.5"
    >
      <div className="flex">
        <Button
          size="sm"
          variant={!canMerge ? "outline" : requirementsMet ? "success" : "default"}
          className={`gap-1.5 rounded-r-none ${
            !canMerge
              ? "disabled:opacity-100"
              : !requirementsMet
                ? "border-warning/80 bg-warning/80 text-bg-root hover:bg-warning/90"
                : ""
          }`}
          disabled={!canMerge || mergeMutation.isPending}
          onClick={() => {
            mergeMutation.mutate({
              cwd,
              prNumber,
              strategy,
              admin: !requirementsMet && canAdmin ? true : undefined,
            });
          }}
        >
          {mergeMutation.isPending ? <Spinner className="h-3 w-3" /> : <GitMerge size={13} />}
          {STRATEGY_LABELS[strategy]}
        </Button>
        <Button
          size="sm"
          variant={!canMerge ? "outline" : requirementsMet ? "success" : "default"}
          className={`rounded-l-none border-l px-1.5 ${
            !canMerge
              ? "disabled:opacity-100"
              : requirementsMet
                ? "border-l-[#08080a]/20"
                : "border-l-bg-root/20 border-warning/80 bg-warning/80 text-bg-root hover:bg-warning/90"
          }`}
          disabled={!canMerge || mergeMutation.isPending || closeMutation.isPending}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <ChevronDown size={12} />
        </Button>
      </div>

      {menuOpen && (
        <div className="border-border bg-bg-elevated absolute top-full right-0 z-20 mt-1 w-48 rounded-md border p-1 shadow-lg">
          {(["squash", "merge", "rebase"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setStrategy(s);
                setMenuOpen(false);
              }}
              className={`flex w-full cursor-pointer items-center rounded-sm px-3 py-1.5 text-left text-xs transition-colors ${
                strategy === s
                  ? "bg-accent-muted text-accent-text"
                  : "text-text-secondary hover:bg-bg-raised hover:text-text-primary"
              }`}
            >
              {STRATEGY_LABELS[s]}
            </button>
          ))}
          <div className="bg-border my-1 h-px" />
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              closeMutation.mutate();
            }}
            disabled={closeMutation.isPending}
            className="text-destructive hover:bg-destructive/10 flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-3 py-1.5 text-left text-xs transition-colors"
          >
            <XCircle size={12} />
            Close pull request
          </button>
        </div>
      )}

      {/* Update branch button */}
      {isBehind && (
        <Button
          size="sm"
          variant="ghost"
          className="text-warning hover:text-warning gap-1 text-[10px]"
          onClick={() => updateBranchMutation.mutate()}
          disabled={updateBranchMutation.isPending}
        >
          {updateBranchMutation.isPending ? (
            <Spinner className="h-2.5 w-2.5" />
          ) : (
            <RefreshCw size={10} />
          )}
          Update branch
        </Button>
      )}

      {/* Auto-merge indicator */}
      {pr.autoMergeRequest && (
        <div className="border-info/30 bg-info/5 flex items-center gap-1 rounded-md border px-2 py-1">
          <GitMerge
            size={11}
            className="text-info"
          />
          <span className="text-info text-[10px] font-medium">Auto-merge</span>
        </div>
      )}
    </div>
  );
}
