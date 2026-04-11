import type { RepoTarget } from "@/shared/ipc";

import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useMutation } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

/**
 * Merge readiness card — PR-REVIEW-REDESIGN.md § Merge readiness card
 *
 * Bottom of review sidebar. Shows title, dot progress + checklist items,
 * and branch behind status with update button.
 */

interface MergeReadinessCardProps {
  hasApproval: boolean;
  allChecksPassing: boolean;
  noConflicts: boolean;
  hasChecks: boolean;
  isBehind: boolean;
  repoTarget: RepoTarget;
  prNumber: number;
}

export function MergeReadinessCard({
  hasApproval,
  allChecksPassing,
  noConflicts,
  hasChecks,
  isBehind,
  repoTarget,
  prNumber,
}: MergeReadinessCardProps) {
  const items = [
    { label: hasChecks ? "CI passed" : "No CI checks", met: allChecksPassing || !hasChecks },
    { label: hasApproval ? "1 approval" : "Approval needed", met: hasApproval },
    { label: noConflicts ? "No conflicts" : "Conflicts", met: noConflicts },
    ...(isBehind ? [{ label: "Branch behind", met: false }] : []),
  ];

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
    <div
      className="bg-bg-raised shrink-0 rounded-lg"
      style={{ margin: "8px", padding: "10px 12px", borderTop: "1px solid var(--border)" }}
    >
      {/* Title */}
      <div className="text-text-tertiary mb-1 text-[10px] font-semibold tracking-[0.06em] uppercase">
        Merge readiness
      </div>

      {/* Dot progress */}
      <div className="mb-[5px] flex items-center gap-1">
        {items.map((item, i) => (
          <span
            key={i}
            className="rounded-full"
            style={{
              width: "6px",
              height: "6px",
              background: item.met ? "var(--success)" : "var(--warning)",
            }}
          />
        ))}
      </div>

      {/* Checklist */}
      <div
        className="flex flex-col"
        style={{ gap: "1px" }}
      >
        {items.map((item, i) => (
          <div
            key={i}
            className="flex items-center gap-1 text-[10px]"
            style={{ padding: "1px 0" }}
          >
            <span
              className="shrink-0 text-[10px]"
              style={{ color: item.met ? "var(--success)" : "var(--warning)" }}
            >
              {item.met ? "✓" : "●"}
            </span>
            <span
              style={{
                color: item.met ? "var(--text-tertiary)" : "var(--text-secondary)",
              }}
            >
              {item.label}
            </span>
            {/* Update button inline with "Branch behind" */}
            {item.label === "Branch behind" && (
              <button
                type="button"
                onClick={() => updateBranchMutation.mutate()}
                disabled={updateBranchMutation.isPending}
                className="text-accent-text hover:text-accent-hover ml-auto flex cursor-pointer items-center gap-0.5 text-[10px] font-medium transition-colors disabled:opacity-50"
              >
                {updateBranchMutation.isPending ? (
                  <Spinner className="h-2.5 w-2.5" />
                ) : (
                  <RefreshCw size={9} />
                )}
                Update
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
