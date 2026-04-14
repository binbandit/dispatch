import type { GhPrDetail, RepoTarget } from "@/shared/ipc";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useMutation } from "@tanstack/react-query";
import { Check, PencilLine, X } from "lucide-react";
import { useCallback, useState } from "react";

/**
 * Editable PR title — click to edit, Enter to save, Esc to cancel.
 */

export function EditablePrTitle({
  canEdit,
  repoTarget,
  nwo,
  prNumber,
  title,
}: {
  canEdit: boolean;
  repoTarget: RepoTarget;
  nwo: string;
  prNumber: number;
  title: string;
}) {
  const [draftTitle, setDraftTitle] = useState(title);
  const [isEditing, setIsEditing] = useState(false);

  // Ref callback — auto-focus and select the input when it mounts (entering edit mode).
  const inputRef = useCallback((node: HTMLInputElement | null) => {
    if (node) {
      requestAnimationFrame(() => {
        node.focus();
        node.select();
      });
    }
  }, []);

  const updateTitleMutation = useMutation({
    mutationFn: (nextTitle: string) =>
      ipc("pr.updateTitle", { ...repoTarget, prNumber, title: nextTitle }),
    onSuccess: (_data, nextTitle) => {
      const updatedAt = new Date().toISOString();

      queryClient.setQueryData<GhPrDetail | undefined>(["pr", "detail", nwo, prNumber], (old) =>
        old ? { ...old, title: nextTitle, updatedAt } : old,
      );

      setDraftTitle(nextTitle);
      setIsEditing(false);

      void queryClient.invalidateQueries({ queryKey: ["pr", "detail", nwo, prNumber] });
      void queryClient.invalidateQueries({ queryKey: ["pr", "list", nwo] });
      void queryClient.invalidateQueries({ queryKey: ["pr", "listAll"] });

      toastManager.add({ title: "Title updated", type: "success" });
    },
    onError: (error) => {
      toastManager.add({
        title: "Title update failed",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    },
  });

  const beginEditing = useCallback(() => {
    if (!canEdit || updateTitleMutation.isPending) {
      return;
    }

    setDraftTitle(title);
    setIsEditing(true);
  }, [canEdit, title, updateTitleMutation.isPending]);

  const cancelEditing = useCallback(() => {
    if (updateTitleMutation.isPending) {
      return;
    }

    setDraftTitle(title);
    setIsEditing(false);
  }, [title, updateTitleMutation.isPending]);

  const saveTitle = useCallback(() => {
    if (updateTitleMutation.isPending) {
      return;
    }

    const nextTitle = draftTitle.trim();
    if (!nextTitle) {
      toastManager.add({
        title: "Title required",
        description: "Pull request titles cannot be empty.",
        type: "error",
      });
      return;
    }

    if (nextTitle === title) {
      setDraftTitle(title);
      setIsEditing(false);
      return;
    }

    updateTitleMutation.mutate(nextTitle);
  }, [draftTitle, title, updateTitleMutation]);

  if (isEditing) {
    return (
      <div className="space-y-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div className="border-border bg-bg-raised focus-within:border-border-strong flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 shadow-[var(--shadow-sm)] transition-[background-color,border-color,box-shadow] duration-[120ms] ease-out focus-within:shadow-[0_0_0_1px_rgba(212,136,58,0.18)]">
            <input
              ref={inputRef}
              autoComplete="off"
              name="pull-request-title"
              type="text"
              value={draftTitle}
              disabled={updateTitleMutation.isPending}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  saveTitle();
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelEditing();
                }
              }}
              className="text-text-primary placeholder:text-text-ghost min-w-0 flex-1 bg-transparent text-[16px] leading-[1.3] font-semibold tracking-[-0.02em] outline-none"
              aria-label={`Edit title for pull request #${prNumber}`}
            />
            <span className="text-text-tertiary shrink-0 text-[16px] leading-[1.3] font-normal">
              #{prNumber}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    loading={updateTitleMutation.isPending}
                    onClick={saveTitle}
                    className="bg-primary text-primary-foreground hover:bg-accent-hover shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-glow)]"
                    aria-label={`Save title for pull request #${prNumber}`}
                  >
                    <Check size={12} />
                  </Button>
                }
              />
              <TooltipPopup>Save title</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={updateTitleMutation.isPending}
                    onClick={cancelEditing}
                    className="text-text-secondary hover:bg-bg-raised hover:text-text-primary"
                    aria-label={`Cancel editing title for pull request #${prNumber}`}
                  >
                    <X size={12} />
                  </Button>
                }
              />
              <TooltipPopup>Cancel</TooltipPopup>
            </Tooltip>
          </div>
        </div>

        <div className="text-text-tertiary flex flex-wrap items-center gap-x-2 gap-y-1 pl-0.5 text-[10px]">
          <div className="flex items-center gap-1.5">
            <Kbd className="border-border-strong bg-bg-raised text-text-secondary h-5 min-w-5 rounded-sm border px-1.5 font-mono text-[10px] font-medium shadow-[0_1px_0_var(--border)]">
              Enter
            </Kbd>
            <span>save</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Kbd className="border-border-strong bg-bg-raised text-text-secondary h-5 min-w-5 rounded-sm border px-1.5 font-mono text-[10px] font-medium shadow-[0_1px_0_var(--border)]">
              Esc
            </Kbd>
            <span>cancel</span>
          </div>
        </div>
      </div>
    );
  }

  if (!canEdit) {
    return (
      <h1 className="text-text-primary text-[16px] leading-[1.3] font-semibold tracking-[-0.02em]">
        {title} <span className="text-text-tertiary font-normal">#{prNumber}</span>
      </h1>
    );
  }

  return (
    <button
      type="button"
      onClick={beginEditing}
      className="group/title focus-visible:ring-primary/30 hover:bg-bg-raised/80 -mx-1 grid max-w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-md px-1 py-0.5 text-left transition-[background-color,color,box-shadow] duration-[120ms] ease-out outline-none focus-visible:ring-2"
      aria-label={`Edit title for pull request #${prNumber}`}
      title="Edit title"
    >
      <span className="text-text-primary min-w-0 text-[16px] leading-[1.3] font-semibold tracking-[-0.02em]">
        {title} <span className="text-text-tertiary font-normal">#{prNumber}</span>
      </span>
      <span className="text-text-ghost border-border/0 bg-bg-raised/0 group-hover/title:border-border-strong group-hover/title:bg-bg-raised/90 group-hover/title:text-accent-text inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-medium transition-[background-color,border-color,color] duration-[120ms] ease-out">
        <PencilLine size={12} />
        Edit
      </span>
    </button>
  );
}
