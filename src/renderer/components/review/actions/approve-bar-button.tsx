/* eslint-disable import/max-dependencies -- Review action button with many focused dependencies. */
import type { RepoTarget } from "@/shared/ipc";

import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { useKeyboardShortcuts } from "@/renderer/hooks/app/use-keyboard-shortcuts";
import { getErrorMessage } from "@/renderer/lib/app/error-message";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useKeybindings } from "@/renderer/lib/keyboard/keybinding-context";
import { formatKeybinding } from "@/renderer/lib/keyboard/keybinding-registry";
import { useMutation } from "@tanstack/react-query";
import { Check } from "lucide-react";

import { btnBase } from "./floating-review-bar";

export function ApproveBarButton({
  repoTarget,
  prNumber,
  currentUserReview,
  isReRequested,
  compact,
  dense,
}: {
  repoTarget: RepoTarget;
  prNumber: number;
  currentUserReview: string | null;
  isReRequested: boolean;
  compact: boolean;
  dense: boolean;
}) {
  const alreadyApproved = currentUserReview === "APPROVED" && !isReRequested;
  const { getBinding } = useKeybindings();
  const approveBinding = getBinding("actions.approve");
  const approveShortcut = formatKeybinding(approveBinding.key, approveBinding.modifiers);

  const reviewMutation = useMutation({
    mutationFn: () =>
      ipc("pr.submitReview", { ...repoTarget, prNumber, event: "APPROVE" as const }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      toastManager.add({ title: "PR approved", type: "success" });
    },
    onError: (err) => {
      toastManager.add({
        title: "Review failed",
        description: getErrorMessage(err),
        type: "error",
      });
    },
  });

  useKeyboardShortcuts([
    {
      ...approveBinding,
      handler: () => reviewMutation.mutate(),
      preventWhileTyping: true,
      when: () => !alreadyApproved && !reviewMutation.isPending,
    },
  ]);

  if (alreadyApproved) {
    return (
      <button
        type="button"
        disabled
        title={dense ? "Approved" : undefined}
        aria-label="Approved"
        style={{
          ...btnBase,
          background: "var(--success)",
          color: "var(--bg-root)",
          borderColor: "var(--success)",
          opacity: 0.6,
          padding: dense ? "5px 7px" : compact ? "5px 8px" : btnBase.padding,
        }}
      >
        <Check size={11} />
        {!dense && "Approved"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => reviewMutation.mutate()}
      disabled={reviewMutation.isPending}
      title={dense ? "Approve" : undefined}
      aria-label="Approve"
      style={{
        ...btnBase,
        background: "var(--success)",
        color: "var(--bg-root)",
        borderColor: "var(--success)",
        opacity: reviewMutation.isPending ? 0.5 : 1,
        padding: dense ? "5px 7px" : compact ? "5px 8px" : btnBase.padding,
      }}
    >
      {reviewMutation.isPending ? <Spinner className="h-3 w-3" /> : <Check size={11} />}
      {!dense && "Approve"}
      {!compact && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", opacity: 0.5 }}>
          {approveShortcut}
        </span>
      )}
    </button>
  );
}
