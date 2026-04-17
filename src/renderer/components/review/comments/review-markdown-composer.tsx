import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  SuggestionBlock,
  parseSuggestions,
} from "@/renderer/components/review/comments/suggestion-block";
import { MarkdownBody } from "@/renderer/components/shared/markdown-body";
import { MentionTextarea } from "@/renderer/components/shared/mention-textarea";
import { useAiTaskConfig } from "@/renderer/hooks/ai/use-ai-task-config";
import { ipc } from "@/renderer/lib/app/ipc";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import {
  buildCommentRewriteMessages,
  hasSelectedText,
  replaceSelection,
} from "@/renderer/lib/review/comment-rewrite";
import {
  applyMarkdownFormat,
  applySuggestionFormat,
  type MarkdownFormatAction,
  type TextSelectionRange,
} from "@/renderer/lib/review/markdown-format";
import { useMutation } from "@tanstack/react-query";
import {
  Bold,
  CheckSquare,
  Code,
  FileCode2,
  Italic,
  Link2,
  List,
  ListOrdered,
  PencilLine,
  Quote,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface ReviewMarkdownComposerProps {
  ariaLabel?: string;
  autoFocus?: boolean;
  className?: string;
  collapseWhenIdle?: boolean;
  compact?: boolean;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  prNumber?: number;
  rows?: number;
  suggestionLanguage?: string;
  suggestionText?: string;
  allowSuggestion?: boolean;
  value: string;
}

const TOOLBAR_ACTIONS: Array<{
  action: MarkdownFormatAction;
  icon: typeof Bold;
  label: string;
  tooltip: string;
}> = [
  { action: "bold", icon: Bold, label: "Bold", tooltip: "Wrap the selection in bold markdown" },
  { action: "italic", icon: Italic, label: "Italic", tooltip: "Emphasize the selection" },
  { action: "inline-code", icon: Code, label: "Inline code", tooltip: "Mark a short code span" },
  {
    action: "code-block",
    icon: FileCode2,
    label: "Code block",
    tooltip: "Insert a fenced code block",
  },
  { action: "link", icon: Link2, label: "Link", tooltip: "Insert a markdown link" },
  {
    action: "blockquote",
    icon: Quote,
    label: "Quote",
    tooltip: "Prefix the selected lines as a quote",
  },
  {
    action: "bullet-list",
    icon: List,
    label: "Bullet list",
    tooltip: "Turn the selection into a bullet list",
  },
  {
    action: "numbered-list",
    icon: ListOrdered,
    label: "Numbered list",
    tooltip: "Turn the selection into a numbered list",
  },
  {
    action: "task-list",
    icon: CheckSquare,
    label: "Task list",
    tooltip: "Insert checkbox list items",
  },
];

export function ReviewMarkdownComposer({
  allowSuggestion = false,
  ariaLabel,
  autoFocus = false,
  className,
  collapseWhenIdle = false,
  compact = false,
  onChange,
  onKeyDown,
  placeholder = "Leave a comment…",
  prNumber,
  rows = 4,
  suggestionLanguage = "text",
  suggestionText,
  value,
}: ReviewMarkdownComposerProps) {
  const { cwd, nwo } = useWorkspace();
  const commentRewriteConfig = useAiTaskConfig("commentRewrite");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSelectionRef = useRef<TextSelectionRange>({ start: value.length, end: value.length });
  const [hasFocus, setHasFocus] = useState(false);
  const [mode, setMode] = useState<"preview" | "write">("write");
  const minHeight = Math.max(rows * (compact ? 18 : 20) + 28, compact ? 108 : 144);
  const isExpanded = !collapseWhenIdle || hasFocus || value.trim().length > 0 || mode === "preview";
  const { bodyParts, suggestions } = useMemo(() => parseSuggestions(value), [value]);

  const getEffectiveSelection = useCallback(
    (candidate?: TextSelectionRange | null): TextSelectionRange => {
      if (candidate && hasSelectedText(candidate)) {
        return candidate;
      }

      if (hasSelectedText(lastSelectionRef.current)) {
        return lastSelectionRef.current;
      }

      return candidate ?? lastSelectionRef.current;
    },
    [],
  );

  const syncSelection = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const nextSelection = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
    lastSelectionRef.current = nextSelection;
  }, []);

  const handleFormat = useCallback(
    (action: MarkdownFormatAction) => {
      const textarea = textareaRef.current;
      const selection = textarea
        ? {
            start: textarea.selectionStart,
            end: textarea.selectionEnd,
          }
        : lastSelectionRef.current;
      const nextValue =
        action === "suggestion"
          ? applySuggestionFormat(value, selection, suggestionText)
          : applyMarkdownFormat(value, selection, action);
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
    [onChange, suggestionText, value],
  );

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
      mode,
      rewriteSelectionMutation,
    ],
  );

  return (
    <div
      className={cn(
        "border-border bg-bg-surface overflow-hidden rounded-lg border shadow-sm",
        collapseWhenIdle && !isExpanded && "bg-bg-raised/70 shadow-none",
        className,
      )}
    >
      {isExpanded && (
        <div className="border-border-subtle bg-bg-surface flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5">
          <div className="border-border bg-bg-root inline-flex items-center rounded-md border p-0.5">
            <ModeButton
              active={mode === "write"}
              compact={compact}
              label="Write"
              tooltip="Edit the raw markdown for this comment"
              onClick={() => setMode("write")}
            />
            <ModeButton
              active={mode === "preview"}
              compact={compact}
              label="Preview"
              tooltip="Preview the comment exactly as Dispatch will render it"
              onClick={() => setMode("preview")}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {TOOLBAR_ACTIONS.map(({ action, icon: Icon, label, tooltip }) => (
              <ToolbarButton
                key={action}
                compact={compact}
                disabled={mode === "preview"}
                label={label}
                tooltip={tooltip}
                onClick={() => handleFormat(action)}
              >
                <Icon size={compact ? 12 : 13} />
              </ToolbarButton>
            ))}
            {allowSuggestion && (
              <ToolbarButton
                compact={compact}
                disabled={mode === "preview"}
                label="Suggested change"
                tooltip="Insert a GitHub suggestion block for a code replacement"
                onClick={() => handleFormat("suggestion")}
              >
                <PencilLine size={compact ? 12 : 13} />
              </ToolbarButton>
            )}
          </div>
        </div>
      )}

      {mode === "write" ? (
        <MentionTextarea
          ariaLabel={ariaLabel ?? placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          name="review-comment"
          onBlur={() => {
            syncSelection();
            setHasFocus(false);
            if (collapseWhenIdle && !value.trim()) {
              setMode("write");
            }
          }}
          onChange={onChange}
          onClick={syncSelection}
          onFocus={() => {
            syncSelection();
            setHasFocus(true);
          }}
          onKeyDown={onKeyDown}
          onSelect={syncSelection}
          placeholder={placeholder}
          prNumber={prNumber}
          rows={isExpanded ? rows : 1}
          textareaClassName={cn(
            "text-text-primary placeholder:text-text-tertiary bg-bg-surface/80 w-full resize-none border-0 font-sans text-xs leading-relaxed outline-none",
            rewriteSelectionMutation.isPending &&
              "dispatch-rewrite-pending border-[--border-accent] shadow-[0_0_0_1px_var(--border-accent)]",
            isExpanded ? "px-3 py-3" : "px-3 py-2",
            compact && isExpanded ? "min-h-[96px] py-2.5" : undefined,
            !compact && isExpanded ? "min-h-[128px]" : undefined,
            !isExpanded && "min-h-[36px]",
          )}
          textareaRef={textareaRef}
          value={value}
          readOnly={rewriteSelectionMutation.isPending}
        />
      ) : (
        <div
          className="bg-bg-surface/70 overflow-y-auto px-3 py-3"
          style={{ minHeight }}
        >
          {value.trim() ? (
            <div className="space-y-2">
              {bodyParts.map((part, index) =>
                part.type === "text" ? (
                  <MarkdownBody
                    key={`preview-text-${index}`}
                    content={part.content}
                    repo={nwo}
                  />
                ) : (
                  <SuggestionBlock
                    key={`preview-suggestion-${index}`}
                    suggestion={part.content}
                    language={suggestionLanguage}
                  />
                ),
              )}
              {bodyParts.length === 0 && suggestions.length === 0 && (
                <MarkdownBody
                  content={value}
                  repo={nwo}
                />
              )}
            </div>
          ) : (
            <div className="border-border-subtle bg-bg-surface/60 flex min-h-full items-center justify-center rounded-md border border-dashed px-4 py-6 text-center">
              <p className="text-text-tertiary max-w-[24rem] text-xs leading-relaxed">
                Nothing to preview yet. Write markdown, add a suggested change, or drop in code and
                switch back here to review the final comment.
              </p>
            </div>
          )}
        </div>
      )}

      {isExpanded && (
        <div className="border-border-subtle bg-bg-surface/80 flex items-center justify-between gap-2 border-t px-3 py-2">
          <span className="text-text-tertiary font-mono text-[10px]">
            Markdown, @mentions, #refs, and suggestions
          </span>
          <span className="text-text-ghost text-[10px]">
            {mode === "write"
              ? rewriteSelectionMutation.isPending
                ? "Rewriting selection with AI…"
                : "Use the native context menu to rewrite selected text with AI"
              : "Switch back to keep editing"}
          </span>
        </div>
      )}
    </div>
  );
}

function ModeButton({
  active,
  compact,
  label,
  tooltip,
  onClick,
}: {
  active: boolean;
  compact: boolean;
  label: string;
  tooltip: string;
  onClick: () => void;
}) {
  const button = (
    <button
      type="button"
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-sm px-2.5 py-1 text-[11px] font-medium transition-colors",
        compact && "px-2 py-0.5 text-[10px]",
        active
          ? "border border-[--border-accent] bg-[--accent-muted] text-[--accent-text]"
          : "text-text-tertiary hover:bg-bg-raised hover:text-text-primary border border-transparent",
      )}
    >
      {label}
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipPopup>{tooltip}</TooltipPopup>
    </Tooltip>
  );
}

function ToolbarButton({
  children,
  compact,
  disabled,
  label,
  tooltip,
  onClick,
}: {
  children: React.ReactNode;
  compact: boolean;
  disabled: boolean;
  label: string;
  tooltip: string;
  onClick: () => void;
}) {
  const button = (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onClick}
      className={cn(
        "border-border-subtle text-text-tertiary hover:text-text-primary hover:bg-bg-raised inline-flex cursor-pointer items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        compact ? "h-7 w-7" : "h-8 w-8",
      )}
    >
      {children}
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipPopup>{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
