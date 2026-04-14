/**
 * AI Suggestion Card — inline card rendered below a code line in the diff.
 *
 * Shows a severity badge, title, collapsible body, and action buttons
 * to post, edit, or dismiss the suggestion.
 */

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MarkdownBody } from "@/renderer/components/shared/markdown-body";
import { getSeverityStyle, type AiSuggestion } from "@/renderer/lib/review/ai-suggestions";
import { Check, ChevronDown, ChevronRight, Pencil, Sparkles, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

interface AiSuggestionCardProps {
  suggestion: AiSuggestion;
  onPost: (suggestion: AiSuggestion, body?: string) => Promise<void>;
  onDismiss: (id: string) => void;
}

export function AiSuggestionCard({ suggestion, onPost, onDismiss }: AiSuggestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(suggestion.body);
  const [posting, setPosting] = useState(false);

  const style = getSeverityStyle(suggestion.severity);
  const preview = useMemo(() => buildSuggestionPreview(suggestion.body), [suggestion.body]);

  const handlePost = useCallback(
    async (body?: string) => {
      setPosting(true);
      try {
        await onPost(suggestion, body);
      } finally {
        setPosting(false);
        setEditing(false);
      }
    },
    [suggestion, onPost],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void handlePost(editBody);
      }
      if (e.key === "Escape") {
        setEditing(false);
        setEditBody(suggestion.body);
      }
    },
    [handlePost, editBody, suggestion.body],
  );

  if (suggestion.status === "posted") {
    return (
      <div className="mx-3 my-2 flex items-center gap-1.5 rounded-md border border-[rgba(61,214,140,0.15)] bg-[rgba(61,214,140,0.06)] px-2.5 py-1.5">
        <Check
          size={12}
          className="text-success"
        />
        <span className="text-success font-mono text-[10px]">AI comment posted</span>
      </div>
    );
  }

  return (
    <div
      className="mx-3 my-2 overflow-hidden rounded-[10px] border bg-[linear-gradient(180deg,var(--comment-card-from),var(--comment-card-to))] shadow-[var(--comment-card-shadow)]"
      style={{
        borderColor: `color-mix(in srgb, ${style.border} 30%, transparent)`,
        boxShadow: `0 8px 24px rgba(0,0,0,0.24), 0 0 0 1px color-mix(in srgb, ${style.border} 10%, transparent) inset`,
      }}
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left transition-colors hover:bg-white/2"
        >
          {expanded ? (
            <ChevronDown
              size={12}
              className="text-text-ghost mt-0.5 shrink-0"
            />
          ) : (
            <ChevronRight
              size={12}
              className="text-text-ghost mt-0.5 shrink-0"
            />
          )}
          <span
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
            style={{
              borderColor: `color-mix(in srgb, ${style.border} 30%, transparent)`,
              backgroundColor: `color-mix(in srgb, ${style.bg} 55%, transparent)`,
              color: style.color,
            }}
          >
            <Sparkles size={10} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span
                className="rounded-[4px] px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.08em] uppercase"
                style={{ backgroundColor: style.bg, color: style.color }}
              >
                {style.label}
              </span>
              <span className="text-text-primary min-w-0 truncate text-xs font-medium">
                {suggestion.title}
              </span>
              <span className="text-text-ghost font-mono text-[10px]">AI</span>
            </div>
            {!expanded && preview && (
              <p className="text-text-secondary mt-1 truncate text-[11px] leading-[1.45]">
                {preview}
              </p>
            )}
          </div>
        </button>
        <button
          type="button"
          aria-label="Dismiss AI suggestion"
          onClick={() => onDismiss(suggestion.id)}
          className="text-text-ghost hover:text-text-primary shrink-0 rounded-sm p-0.5 transition-colors"
        >
          <X size={11} />
        </button>
      </div>

      {expanded && (
        <div
          className="border-t px-3 pt-2.5 pb-3"
          style={{ borderColor: `color-mix(in srgb, ${style.border} 15%, transparent)` }}
        >
          {editing ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                onKeyDown={handleKeyDown}
                className="border-border bg-bg-root/80 text-text-primary min-h-[96px] w-full rounded-md border p-2.5 font-mono text-xs leading-relaxed focus:outline-none"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="default"
                  className="gap-1 text-[11px]"
                  disabled={posting || editBody.trim().length === 0}
                  onClick={() => void handlePost(editBody)}
                >
                  {posting ? <Spinner className="h-3 w-3" /> : <Check size={12} />}
                  Post
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-[11px]"
                  onClick={() => {
                    setEditing(false);
                    setEditBody(suggestion.body);
                  }}
                >
                  Cancel
                </Button>
                <span className="text-text-ghost ml-auto font-mono text-[9px]">
                  ⌘Enter to submit
                </span>
              </div>
            </div>
          ) : (
            <>
              <div
                className="overflow-hidden rounded-md border"
                style={{
                  borderColor: `color-mix(in srgb, ${style.border} 18%, transparent)`,
                  backgroundColor: `color-mix(in srgb, ${style.bg} 32%, transparent)`,
                }}
              >
                <div className="border-border-subtle border-b px-2.5 py-1.5">
                  <span className="text-text-ghost font-mono text-[10px]">
                    Pending AI review comment
                  </span>
                </div>
                <div className="px-3 py-2.5">
                  <MarkdownBody
                    content={suggestion.body}
                    className="text-text-secondary text-[12px] leading-[1.55]"
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="default"
                  className="gap-1 text-[11px]"
                  disabled={posting}
                  onClick={() => void handlePost()}
                >
                  {posting ? <Spinner className="h-3 w-3" /> : <Check size={12} />}
                  Post comment
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1 text-[11px]"
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={11} />
                  Edit
                </Button>
                <span className="text-text-ghost ml-auto font-mono text-[10px]">
                  Posts inline on this line
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function AiSuggestionGroup({
  suggestions,
  onPost,
  onDismiss,
}: {
  suggestions: AiSuggestion[];
  onPost: (suggestion: AiSuggestion, body?: string) => Promise<void>;
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="py-0.5">
      {suggestions.map((s) => (
        <AiSuggestionCard
          key={s.id}
          suggestion={s}
          onPost={onPost}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}

function buildSuggestionPreview(body: string): string {
  const flattened = body
    .replaceAll(/```suggestion[\s\S]*?```/g, "Suggested change")
    .replaceAll(/```[\s\S]*?```/g, "Code block")
    .replaceAll(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replaceAll(/^>\s?/gm, "")
    .replaceAll(/^#{1,6}\s+/gm, "")
    .replaceAll(/[*_`~]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();

  if (flattened.length <= 120) {
    return flattened;
  }

  return `${flattened.slice(0, 119).trimEnd()}…`;
}
