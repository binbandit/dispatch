import { cn } from "@/lib/utils";
import { MarkdownBody } from "@/renderer/components/shared/markdown-body";
import { MentionTextarea } from "@/renderer/components/shared/mention-textarea";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import {
  applyMarkdownFormat,
  type MarkdownFormatAction,
  type TextSelectionRange,
} from "@/renderer/lib/review/markdown-format";
import {
  Bold,
  CheckSquare,
  Code,
  FileCode2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";

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
  value: string;
}

const TOOLBAR_ACTIONS: Array<{
  action: MarkdownFormatAction;
  icon: typeof Bold;
  label: string;
}> = [
  { action: "bold", icon: Bold, label: "Bold" },
  { action: "italic", icon: Italic, label: "Italic" },
  { action: "inline-code", icon: Code, label: "Inline code" },
  { action: "code-block", icon: FileCode2, label: "Code block" },
  { action: "link", icon: Link2, label: "Link" },
  { action: "blockquote", icon: Quote, label: "Quote" },
  { action: "bullet-list", icon: List, label: "Bullet list" },
  { action: "numbered-list", icon: ListOrdered, label: "Numbered list" },
  { action: "task-list", icon: CheckSquare, label: "Task list" },
];

export function ReviewMarkdownComposer({
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
  value,
}: ReviewMarkdownComposerProps) {
  const { nwo } = useWorkspace();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSelectionRef = useRef<TextSelectionRange>({ start: value.length, end: value.length });
  const [hasFocus, setHasFocus] = useState(false);
  const [mode, setMode] = useState<"preview" | "write">("write");
  const minHeight = Math.max(rows * (compact ? 18 : 20) + 28, compact ? 108 : 144);
  const isExpanded = !collapseWhenIdle || hasFocus || value.trim().length > 0 || mode === "preview";

  const syncSelection = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    lastSelectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
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
      const formatted = applyMarkdownFormat(value, selection, action);
      onChange(formatted.value);
      lastSelectionRef.current = formatted.selection;
      setMode("write");

      requestAnimationFrame(() => {
        const nextTextarea = textareaRef.current;
        if (!nextTextarea) {
          return;
        }

        nextTextarea.focus();
        nextTextarea.setSelectionRange(formatted.selection.start, formatted.selection.end);
      });
    },
    [onChange, value],
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
        <div className="border-border-subtle bg-bg-surface/80 flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5">
          <div className="bg-bg-root/80 border-border-subtle inline-flex items-center rounded-md border p-0.5">
            <ModeButton
              active={mode === "write"}
              compact={compact}
              label="Write"
              onClick={() => setMode("write")}
            />
            <ModeButton
              active={mode === "preview"}
              compact={compact}
              label="Preview"
              onClick={() => setMode("preview")}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {TOOLBAR_ACTIONS.map(({ action, icon: Icon, label }) => (
              <button
                key={action}
                type="button"
                aria-label={label}
                title={label}
                disabled={mode === "preview"}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => handleFormat(action)}
                className={cn(
                  "border-border-subtle text-text-tertiary hover:text-text-primary hover:bg-bg-raised inline-flex cursor-pointer items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  compact ? "h-7 w-7" : "h-8 w-8",
                )}
              >
                <Icon size={compact ? 12 : 13} />
              </button>
            ))}
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
            "text-text-primary placeholder:text-text-tertiary bg-bg-root/50 w-full resize-none border-0 font-sans text-xs leading-relaxed outline-none",
            isExpanded ? "px-3 py-3" : "px-3 py-2",
            compact && isExpanded ? "min-h-[96px] py-2.5" : undefined,
            !compact && isExpanded ? "min-h-[128px]" : undefined,
            !isExpanded && "min-h-[36px]",
          )}
          textareaRef={textareaRef}
          value={value}
        />
      ) : (
        <div
          className="bg-bg-root/45 overflow-y-auto px-3 py-3"
          style={{ minHeight }}
        >
          {value.trim() ? (
            <MarkdownBody
              content={value}
              repo={nwo}
            />
          ) : (
            <div className="border-border-subtle bg-bg-surface/60 flex min-h-full items-center justify-center rounded-md border border-dashed px-4 py-6 text-center">
              <p className="text-text-tertiary max-w-[24rem] text-xs leading-relaxed">
                Nothing to preview yet. Write markdown, add mentions, or drop in code and switch
                back here to review the final comment.
              </p>
            </div>
          )}
        </div>
      )}

      {isExpanded && (
        <div className="border-border-subtle bg-bg-surface/80 flex items-center justify-between gap-2 border-t px-3 py-2">
          <span className="text-text-tertiary font-mono text-[10px]">
            Markdown, @mentions, and #refs
          </span>
          <span className="text-text-ghost text-[10px]">
            {mode === "write"
              ? "Preview matches Dispatch rendering"
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
  onClick,
}: {
  active: boolean;
  compact: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
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
}
