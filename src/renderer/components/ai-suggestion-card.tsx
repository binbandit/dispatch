/**
 * AI Suggestion Card — inline card rendered below a code line in the diff.
 *
 * Shows a severity badge, title, collapsible body, and action buttons
 * to post, edit, or dismiss the suggestion.
 */

import type { AiSuggestion } from "../lib/ai-suggestions";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Check, ChevronDown, ChevronRight, Pencil, Sparkles, X } from "lucide-react";
import { useCallback, useState } from "react";

import { getSeverityStyle } from "../lib/ai-suggestions";
import { MarkdownBody } from "./markdown-body";

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
      <div className="mx-3 my-1 flex items-center gap-1.5 px-2 py-1">
        <Check
          size={12}
          className="text-green-500"
        />
        <span className="text-text-ghost text-[10px]">Posted</span>
      </div>
    );
  }

  return (
    <div
      className="mx-3 my-1.5 overflow-hidden rounded-lg border"
      style={{
        borderColor: `color-mix(in srgb, ${style.border} 30%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${style.bg} 40%, transparent)`,
      }}
    >
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left"
      >
        {expanded ? (
          <ChevronDown
            size={12}
            className="text-text-ghost shrink-0"
          />
        ) : (
          <ChevronRight
            size={12}
            className="text-text-ghost shrink-0"
          />
        )}
        <Sparkles
          size={12}
          style={{ color: style.color }}
          className="shrink-0"
        />
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase"
          style={{ backgroundColor: style.bg, color: style.color }}
        >
          {style.label}
        </span>
        <span className="text-text-primary min-w-0 truncate text-xs font-medium">
          {suggestion.title}
        </span>
        <div className="flex-1" />
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(suggestion.id);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.stopPropagation();
              onDismiss(suggestion.id);
            }
          }}
          className="text-text-ghost hover:text-text-primary shrink-0 p-0.5"
        >
          <X size={11} />
        </span>
      </button>

      {expanded && (
        <div
          className="border-t px-3 pt-2 pb-2"
          style={{ borderColor: `color-mix(in srgb, ${style.border} 15%, transparent)` }}
        >
          {editing ? (
            <div className="flex flex-col gap-2">
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                onKeyDown={handleKeyDown}
                className="border-border bg-bg-root text-text-primary min-h-[80px] w-full rounded-md border p-2 font-mono text-xs focus:outline-none"
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
                <span className="text-text-ghost ml-auto text-[9px]">⌘Enter to submit</span>
              </div>
            </div>
          ) : (
            <>
              <MarkdownBody
                content={suggestion.body}
                className="text-xs"
              />
              <div className="mt-2 flex items-center gap-2">
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
