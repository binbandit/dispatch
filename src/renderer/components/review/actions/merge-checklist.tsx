import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { summarizePrChecks } from "@/renderer/lib/review/pr-check-status";
import { useMutation } from "@tanstack/react-query";
import { GitMerge, RefreshCw } from "lucide-react";

/**
 * Merge checklist — DISPATCH-DESIGN-SYSTEM.md § 8.8
 *
 * Shows review approval, CI checks, merge conflict status,
 * branch behind status with update button, and auto-merge indicator.
 */

export function MergeChecklist({
  pr,
  repoTarget,
  prNumber,
}: {
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
  repoTarget: import("@/shared/ipc").RepoTarget;
  prNumber: number;
}) {
  const hasApproval = pr.reviewDecision === "APPROVED";
  const checkSummary = summarizePrChecks(pr.statusCheckRollup);
  const allChecksPassing =
    checkSummary.failed === 0 && checkSummary.pending === 0 && checkSummary.total > 0;
  const noConflicts = pr.mergeable === "MERGEABLE";
  const isBehind = pr.mergeStateStatus === "BEHIND";

  const updateBranchMutation = useMutation({
    mutationFn: () => ipc("pr.updateBranch", { ...repoTarget, prNumber }),
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

  return (
    <div className="border-border bg-bg-raised border-t p-3">
      <div className="flex flex-col gap-1.5">
        <ChecklistItem
          label="Review approved"
          passed={hasApproval}
        />
        <ChecklistItem
          label={pr.statusCheckRollup.length === 0 ? "No CI checks" : "CI checks passing"}
          passed={allChecksPassing}
        />
        <ChecklistItem
          label={pr.mergeable === "CONFLICTING" ? "Merge conflicts" : "No merge conflicts"}
          passed={noConflicts}
        />
        {isBehind && (
          <div className="flex items-center gap-1.5">
            <span className="text-warning flex h-[13px] w-[13px] items-center justify-center text-[10px]">
              ●
            </span>
            <span className="text-warning text-[11px]">Branch is behind</span>
            <button
              type="button"
              onClick={() => updateBranchMutation.mutate()}
              disabled={updateBranchMutation.isPending}
              className="text-accent-text hover:text-accent-hover ml-auto flex cursor-pointer items-center gap-1 text-[10px] font-medium transition-colors disabled:opacity-50"
            >
              {updateBranchMutation.isPending ? (
                <Spinner className="h-2.5 w-2.5" />
              ) : (
                <RefreshCw size={10} />
              )}
              Update
            </button>
          </div>
        )}
      </div>

      {/* Auto-merge indicator */}
      {pr.autoMergeRequest && (
        <div className="border-border-subtle mt-2 flex items-center gap-1.5 border-t pt-2">
          <GitMerge
            size={11}
            className="text-info shrink-0"
          />
          <span className="text-info text-[10px]">
            Auto-merge enabled
            <span className="text-text-tertiary">
              {" "}
              · {pr.autoMergeRequest.mergeMethod.toLowerCase()} by{" "}
              {pr.autoMergeRequest.enabledBy.login}
            </span>
          </span>
        </div>
      )}
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
