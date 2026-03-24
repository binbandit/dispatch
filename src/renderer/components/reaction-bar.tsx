import type { GhReactionContent, GhReactionGroup } from "@/shared/ipc";

import { toastManager } from "@/components/ui/toast";
import { useMutation } from "@tanstack/react-query";
import { SmilePlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ipc } from "../lib/ipc";
import { queryClient } from "../lib/query-client";
import { useWorkspace } from "../lib/workspace-context";

const REACTION_EMOJI: Record<GhReactionContent, string> = {
  THUMBS_UP: "\u{1F44D}",
  THUMBS_DOWN: "\u{1F44E}",
  LAUGH: "\u{1F604}",
  HOORAY: "\u{1F389}",
  CONFUSED: "\u{1F615}",
  HEART: "\u{2764}\uFE0F",
  ROCKET: "\u{1F680}",
  EYES: "\u{1F440}",
};

const ALL_REACTIONS: GhReactionContent[] = [
  "THUMBS_UP",
  "THUMBS_DOWN",
  "LAUGH",
  "HOORAY",
  "CONFUSED",
  "HEART",
  "ROCKET",
  "EYES",
];

interface ReactionBarProps {
  reactions: GhReactionGroup[];
  subjectId: string;
  prNumber: number;
}

export function ReactionBar({ reactions, subjectId, prNumber }: ReactionBarProps) {
  const { cwd } = useWorkspace();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [optimistic, setOptimistic] = useState<
    Map<GhReactionContent, { count: number; viewerHasReacted: boolean }>
  >(new Map());

  // Merge server reactions with optimistic updates
  const merged = getMergedReactions(reactions, optimistic);

  const toggleMutation = useMutation({
    mutationFn: async (args: { content: GhReactionContent; removing: boolean }) => {
      if (args.removing) {
        await ipc("pr.removeReaction", { cwd, subjectId, content: args.content });
      } else {
        await ipc("pr.addReaction", { cwd, subjectId, content: args.content });
      }
    },
    onMutate: (args) => {
      // Optimistic update
      const existing = merged.find((r) => r.content === args.content);
      setOptimistic((prev) => {
        const next = new Map(prev);
        next.set(args.content, {
          count: args.removing
            ? Math.max(0, (existing?.count ?? 1) - 1)
            : (existing?.count ?? 0) + 1,
          viewerHasReacted: !args.removing,
        });
        return next;
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr", "reactions", cwd, prNumber] });
    },
    onError: (err: Error) => {
      // Revert optimistic update
      setOptimistic(new Map());
      toastManager.add({ title: "Reaction failed", description: err.message, type: "error" });
    },
  });

  // Reset optimistic state when server data changes
  const reactionsKey = reactions
    .map((r) => `${r.content}:${r.count}:${r.viewerHasReacted}`)
    .join(",");
  const prevKeyRef = useRef(reactionsKey);
  if (prevKeyRef.current !== reactionsKey) {
    prevKeyRef.current = reactionsKey;
    if (optimistic.size > 0) {
      setOptimistic(new Map());
    }
  }

  const handleToggle = useCallback(
    (content: GhReactionContent) => {
      const existing = merged.find((r) => r.content === content);
      toggleMutation.mutate({ content, removing: existing?.viewerHasReacted ?? false });
      setPickerOpen(false);
    },
    [merged, toggleMutation],
  );

  const visible = merged.filter((r) => r.count > 0);

  // Don't render anything if no reactions and no way to add (no subjectId)
  if (!subjectId) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((r) => (
        <button
          key={r.content}
          type="button"
          onClick={() => handleToggle(r.content)}
          className="inline-flex cursor-pointer items-center gap-[3px] rounded-full border transition-colors"
          style={{
            padding: "1px 6px",
            fontSize: "11px",
            lineHeight: "18px",
            background: r.viewerHasReacted ? "var(--accent-muted)" : "var(--bg-raised)",
            borderColor: r.viewerHasReacted ? "var(--border-accent)" : "var(--border)",
            color: r.viewerHasReacted ? "var(--accent-text)" : "var(--text-secondary)",
          }}
          title={`${r.content.toLowerCase().replace("_", " ")}${r.viewerHasReacted ? " (you)" : ""}`}
        >
          <span style={{ fontSize: "12px" }}>{REACTION_EMOJI[r.content]}</span>
          <span className="font-mono text-[10px] font-medium">{r.count}</span>
        </button>
      ))}

      {/* Add reaction button */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen(!pickerOpen)}
          className="text-text-ghost hover:text-text-tertiary hover:bg-bg-raised inline-flex cursor-pointer items-center rounded-full border border-transparent p-0.5 transition-colors"
          title="Add reaction"
        >
          <SmilePlus size={14} />
        </button>

        {pickerOpen && (
          <ReactionPicker
            onSelect={handleToggle}
            onClose={() => setPickerOpen(false)}
            activeReactions={
              new Set(visible.filter((r) => r.viewerHasReacted).map((r) => r.content))
            }
          />
        )}
      </div>
    </div>
  );
}

function getMergedReactions(
  server: GhReactionGroup[],
  optimistic: Map<GhReactionContent, { count: number; viewerHasReacted: boolean }>,
): GhReactionGroup[] {
  const map = new Map<GhReactionContent, GhReactionGroup>();

  for (const r of server) {
    map.set(r.content, { ...r });
  }

  for (const [content, override] of optimistic) {
    map.set(content, { content, ...override });
  }

  return [...map.values()];
}

function ReactionPicker({
  onSelect,
  onClose,
  activeReactions,
}: {
  onSelect: (content: GhReactionContent) => void;
  onClose: () => void;
  activeReactions: Set<GhReactionContent>;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 z-50 mb-1 rounded-lg border p-1 shadow-lg"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--border)",
      }}
    >
      <div className="flex gap-0.5">
        {ALL_REACTIONS.map((content) => (
          <button
            key={content}
            type="button"
            onClick={() => onSelect(content)}
            className="cursor-pointer rounded-md p-1 transition-colors"
            style={{
              background: activeReactions.has(content) ? "var(--accent-muted)" : "transparent",
              fontSize: "16px",
              lineHeight: "1",
            }}
            title={content.toLowerCase().replace("_", " ")}
          >
            {REACTION_EMOJI[content]}
          </button>
        ))}
      </div>
    </div>
  );
}
