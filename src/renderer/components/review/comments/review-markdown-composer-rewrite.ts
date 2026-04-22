import type { TextSelectionRange } from "@/renderer/lib/review/markdown-format";

import { toastManager } from "@/components/ui/toast";
import { useAiTaskConfig } from "@/renderer/hooks/ai/use-ai-task-config";
import { ipc } from "@/renderer/lib/app/ipc";
import {
  buildCommentRewriteMessages,
  hasSelectedText,
  replaceSelection,
} from "@/renderer/lib/review/comment-rewrite";
import { useMutation } from "@tanstack/react-query";
import { type MutableRefObject, type RefObject, useEffect } from "react";

type ComposerMode = "preview" | "write";

interface UseReviewMarkdownComposerRewriteArgs {
  cwd: string | null;
  getEffectiveSelection: (candidate?: TextSelectionRange | null) => TextSelectionRange;
  hasFocus: boolean;
  lastSelectionRef: MutableRefObject<TextSelectionRange>;
  mode: ComposerMode;
  onChange: (value: string) => void;
  setMode: (mode: ComposerMode) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
}

export function useReviewMarkdownComposerRewrite({
  cwd,
  getEffectiveSelection,
  hasFocus,
  lastSelectionRef,
  mode,
  onChange,
  setMode,
  textareaRef,
  value,
}: UseReviewMarkdownComposerRewriteArgs): {
  isConfigured: boolean;
  isPending: boolean;
} {
  const commentRewriteConfig = useAiTaskConfig("commentRewrite");

  const rewriteSelectionMutation = useMutation({
    mutationFn: async () => {
      const activeSelection = getEffectiveSelection(
        textareaRef.current
          ? {
              start: textareaRef.current.selectionStart,
              end: textareaRef.current.selectionEnd,
            }
          : null,
      );

      if (!hasSelectedText(activeSelection)) {
        throw new Error("Select part of your comment to rewrite.");
      }

      const rewrittenText = await ipc("ai.complete", {
        cwd: cwd ?? undefined,
        task: "commentRewrite",
        messages: buildCommentRewriteMessages(
          value,
          value.slice(activeSelection.start, activeSelection.end),
        ),
        maxTokens: 512,
      });

      return {
        activeSelection,
        rewrittenText: rewrittenText.trim(),
      };
    },
    onSuccess: ({ activeSelection, rewrittenText }) => {
      const nextValue = replaceSelection(value, activeSelection, rewrittenText);
      onChange(nextValue.value);
      lastSelectionRef.current = nextValue.selection;
      setMode("write");

      requestAnimationFrame(() => {
        const nextTextarea = textareaRef.current;
        if (!nextTextarea) {
          return;
        }

        nextTextarea.focus();
        nextTextarea.setSelectionRange(nextValue.selection.start, nextValue.selection.end);
      });
    },
    onError: (error) => {
      toastManager.add({
        title: "Rewrite failed",
        description: error instanceof Error ? error.message : "Could not rewrite the selection.",
        type: "error",
      });
    },
  });

  useEffect(
    () =>
      globalThis.api.onAiRewriteSelection(() => {
        if (
          mode === "preview" ||
          !commentRewriteConfig.isConfigured ||
          (!hasFocus && document.activeElement !== textareaRef.current)
        ) {
          return;
        }

        const nextSelection = getEffectiveSelection(
          textareaRef.current
            ? {
                start: textareaRef.current.selectionStart,
                end: textareaRef.current.selectionEnd,
              }
            : null,
        );

        lastSelectionRef.current = nextSelection;

        if (!hasSelectedText(nextSelection) || rewriteSelectionMutation.isPending) {
          return;
        }

        rewriteSelectionMutation.mutate();
      }),
    [
      commentRewriteConfig.isConfigured,
      getEffectiveSelection,
      hasFocus,
      lastSelectionRef,
      mode,
      rewriteSelectionMutation,
      textareaRef,
    ],
  );

  return {
    isConfigured: commentRewriteConfig.isConfigured,
    isPending: rewriteSelectionMutation.isPending,
  };
}
