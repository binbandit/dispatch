/* eslint-disable import/max-dependencies -- Merge action button with many focused dependencies. */
import type { RepoTarget } from "@/shared/ipc";

import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { useKeyboardShortcuts } from "@/renderer/hooks/app/use-keyboard-shortcuts";
import { getErrorMessage } from "@/renderer/lib/app/error-message";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useKeybindings } from "@/renderer/lib/keyboard/keybinding-context";
import { resolveMergeStrategy } from "@/renderer/lib/review/merge-strategy";
import { summarizePrChecks } from "@/renderer/lib/review/pr-check-status";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, GitMerge, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { btnBase } from "./floating-review-bar";

export function MergeBarButton({
  repoTarget,
  prNumber,
  pr,
  canAdmin,
  hasMergeQueue,
  isDraft,
  compact,
  dense,
}: {
  repoTarget: RepoTarget;
  prNumber: number;
  pr: {
    reviewDecision: string;
    mergeable: string;
    statusCheckRollup: Array<{ conclusion: string | null }>;
    autoMergeRequest: {
      enabledBy: { login: string };
      mergeMethod: string;
    } | null;
  };
  canAdmin: boolean;
  hasMergeQueue: boolean;
  isDraft: boolean;
  compact: boolean;
  dense: boolean;
}) {
  const hasApproval = pr.reviewDecision === "APPROVED";
  const checkSummary = summarizePrChecks(pr.statusCheckRollup);
  const allChecksPassing =
    checkSummary.failed === 0 && checkSummary.pending === 0 && checkSummary.total > 0;
  const requirementsMet = hasApproval && allChecksPassing && pr.mergeable === "MERGEABLE";
  const canMerge = requirementsMet || canAdmin;

  const [menuOpen, setMenuOpen] = useState(false);
  const [strategy, setStrategy] = useState<"squash" | "merge" | "rebase">("squash");
  const menuRef = useRef<HTMLDivElement>(null);
  const { getBinding } = useKeybindings();

  const mergeMutation = useMutation({
    mutationFn: (args: { admin?: boolean } | void) => {
      const resolved = resolveMergeStrategy({
        hasMergeQueue,
        requirementsMet,
        canAdmin,
        explicitAdmin: args?.admin,
        strategy,
      });

      return ipc("pr.merge", {
        ...repoTarget,
        prNumber,
        strategy: resolved.strategy,
        admin: resolved.admin,
        auto: resolved.auto,
        hasMergeQueue,
      });
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });

      // Check if auto-merge was used
      const resolved = resolveMergeStrategy({
        hasMergeQueue,
        requirementsMet,
        canAdmin,
        explicitAdmin: variables?.admin,
        strategy,
      });

      if (resolved.auto) {
        // With --auto flag, GitHub enables auto-merge (doesn't immediately merge if requirements not met)
        if (requirementsMet) {
          // Requirements met: either merged immediately or queued in merge queue
          if (result.queued) {
            toastManager.add({
              title: `PR #${prNumber} queued for merge`,
              type: "success",
            });
          } else {
            toastManager.add({
              title: `PR #${prNumber} merged`,
              description: "Branch deleted.",
              type: "success",
            });
          }
        } else {
          // Requirements NOT met: auto-merge enabled, will merge when ready
          toastManager.add({
            title: `Auto-merge enabled for PR #${prNumber}`,
            description: "Will merge when checks pass and approvals are received",
            type: "success",
          });
        }
      } else {
        // Admin or standard merge (immediate)
        toastManager.add({
          title: `PR #${prNumber} merged`,
          description: "Branch deleted.",
          type: "success",
        });
      }
    },
    onError: (err) => {
      toastManager.add({ title: "Merge failed", description: getErrorMessage(err), type: "error" });
    },
  });

  const labels: Record<string, string> = {
    squash: "Squash & Merge",
    merge: "Merge",
    rebase: "Rebase & Merge",
  };

  // Disable if auto-merge is already enabled
  const autoMergeAlreadyEnabled = pr.autoMergeRequest !== null;
  const disabled = isDraft || !canMerge || autoMergeAlreadyEnabled;

  useKeyboardShortcuts([
    {
      ...getBinding("actions.merge"),
      handler: () => mergeMutation.mutate(),
      when: () => !disabled && !mergeMutation.isPending && !menuOpen,
    },
  ]);

  // Close dropdown on Escape or click outside
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeMenu();
      }
    };
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    globalThis.addEventListener("keydown", handleKey, true);
    globalThis.addEventListener("mousedown", handleClick);
    return () => {
      globalThis.removeEventListener("keydown", handleKey, true);
      globalThis.removeEventListener("mousedown", handleClick);
    };
  }, [menuOpen, closeMenu]);

  const mainBg = disabled ? "var(--bg-raised)" : "var(--success)";
  const mainColor = disabled ? "var(--text-tertiary)" : "var(--bg-root)";
  const mainBorder = disabled ? "var(--border)" : "var(--success)";
  const mainCursor = disabled ? "not-allowed" : "pointer";

  // Merge queue mode: "Merge when ready" with admin-only dropdown
  if (hasMergeQueue) {
    return (
      <div
        ref={menuRef}
        style={{ position: "relative", display: "flex" }}
      >
        <button
          type="button"
          onClick={() => mergeMutation.mutate()}
          disabled={isDraft || !canMerge || mergeMutation.isPending}
          title={dense ? "Merge when ready" : undefined}
          aria-label="Merge when ready"
          style={{
            ...btnBase,
            background: mainBg,
            color: mainColor,
            borderColor: mainBorder,
            cursor: mainCursor,
            borderTopRightRadius: canAdmin ? 0 : undefined,
            borderBottomRightRadius: canAdmin ? 0 : undefined,
            padding: dense ? "5px 7px" : compact ? "5px 8px" : btnBase.padding,
          }}
        >
          {mergeMutation.isPending ? <Spinner className="h-3 w-3" /> : <GitMerge size={11} />}
          {!dense && (compact ? "Ready" : "Merge when ready")}
          {!compact && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", opacity: 0.5 }}>m</span>
          )}
        </button>
        {canAdmin && (
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            style={{
              ...btnBase,
              background: mainBg,
              color: mainColor,
              borderColor: mainBorder,
              borderLeft: disabled ? "1px solid var(--border)" : "1px solid var(--bg-overlay)",
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
              padding: "5px 4px",
            }}
          >
            <ChevronDown size={10} />
          </button>
        )}
        {menuOpen && (
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              right: 0,
              marginBottom: "4px",
              width: "180px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "4px",
              boxShadow: "var(--shadow-lg)",
              zIndex: 50,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                mergeMutation.mutate({ admin: true });
              }}
              disabled={mergeMutation.isPending}
              style={{
                display: "flex",
                width: "100%",
                alignItems: "center",
                gap: "6px",
                padding: "6px 10px",
                borderRadius: "var(--radius-sm)",
                fontSize: "10px",
                cursor: "pointer",
                border: "none",
                background: "transparent",
                color: "var(--warning)",
              }}
            >
              <ShieldAlert size={11} />
              Merge now (admin)
            </button>
          </div>
        )}
      </div>
    );
  }

  // Standard mode: split button with strategy selection
  return (
    <div
      ref={menuRef}
      style={{ position: "relative", display: "flex" }}
    >
      <button
        type="button"
        onClick={() => mergeMutation.mutate()}
        disabled={isDraft || !canMerge || mergeMutation.isPending}
        title={dense ? labels[strategy] : undefined}
        aria-label={labels[strategy]}
        style={{
          ...btnBase,
          background: mainBg,
          color: mainColor,
          borderColor: mainBorder,
          cursor: mainCursor,
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
          padding: dense ? "5px 7px" : compact ? "5px 8px" : btnBase.padding,
        }}
      >
        {mergeMutation.isPending ? <Spinner className="h-3 w-3" /> : <GitMerge size={11} />}
        {!dense && (compact ? "Merge" : labels[strategy])}
        {!compact && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", opacity: 0.5 }}>m</span>
        )}
      </button>
      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        style={{
          ...btnBase,
          background: mainBg,
          color: mainColor,
          borderColor: mainBorder,
          borderLeft: disabled ? "1px solid var(--border)" : "1px solid var(--bg-overlay)",
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          padding: "5px 4px",
        }}
      >
        <ChevronDown size={10} />
      </button>
      {menuOpen && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            right: 0,
            marginBottom: "4px",
            width: "180px",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            padding: "4px",
            boxShadow: "var(--shadow-lg)",
            zIndex: 50,
          }}
        >
          {(["squash", "merge", "rebase"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setStrategy(s);
                setMenuOpen(false);
              }}
              style={{
                display: "flex",
                width: "100%",
                padding: "6px 10px",
                borderRadius: "var(--radius-sm)",
                fontSize: "10px",
                cursor: "pointer",
                border: "none",
                background: strategy === s ? "var(--accent-muted)" : "transparent",
                color: strategy === s ? "var(--accent-text)" : "var(--text-secondary)",
                textAlign: "left",
              }}
            >
              {labels[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
