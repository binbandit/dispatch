import type { ReviewComment } from "@/renderer/components/review/comments/inline-comment";

import { toastManager } from "@/components/ui/toast";
import { openExternal } from "@/renderer/lib/app/open-external";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { Copy, Edit3, ExternalLink, MessageSquare, Reply } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

export function CommentContextMenu({
  comment,
  position,
  onClose,
  onReply,
  canEdit,
  onEdit,
  prNumber,
}: {
  comment: ReviewComment;
  position: { x: number; y: number };
  onClose: () => void;
  onReply?: () => void;
  canEdit?: boolean;
  onEdit?: () => void;
  prNumber?: number;
}) {
  const { nwo } = useWorkspace();
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  const handleClick = useCallback(
    (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose],
  );

  // Register global listeners for click-outside and Escape
  useEffect(() => {
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [handleClick, handleEscape]);

  return (
    <div
      ref={menuRef}
      className="border-border bg-bg-elevated fixed z-50 rounded-md border p-1 shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      {onReply && (
        <ContextMenuItem
          icon={<Reply size={12} />}
          label="Reply"
          onClick={() => {
            onReply();
            onClose();
          }}
        />
      )}
      {canEdit && onEdit && (
        <ContextMenuItem
          icon={<Edit3 size={12} />}
          label="Edit"
          onClick={() => {
            onEdit();
            onClose();
          }}
        />
      )}
      <ContextMenuItem
        icon={<Copy size={12} />}
        label="Copy text"
        onClick={() => {
          navigator.clipboard.writeText(comment.body);
          toastManager.add({ title: "Copied", type: "success" });
          onClose();
        }}
      />
      <ContextMenuItem
        icon={<Copy size={12} />}
        label="Copy link"
        onClick={() => {
          const repoSlug = nwo;
          const url = prNumber
            ? `https://github.com/${repoSlug}/pull/${prNumber}#discussion_r${comment.id}`
            : `https://github.com/${repoSlug}#discussion_r${comment.id}`;
          navigator.clipboard.writeText(url);
          toastManager.add({ title: "Link copied", type: "success" });
          onClose();
        }}
      />
      <ContextMenuItem
        icon={<ExternalLink size={12} />}
        label="Open in browser"
        onClick={() => {
          const repoSlug = nwo;
          const url = prNumber
            ? `https://github.com/${repoSlug}/pull/${prNumber}#discussion_r${comment.id}`
            : `https://github.com/${repoSlug}#discussion_r${comment.id}`;
          void openExternal(url);
          onClose();
        }}
      />
      <div style={{ height: "1px", background: "var(--border)", margin: "2px 0" }} />
      <ContextMenuItem
        icon={<MessageSquare size={12} />}
        label="Quote reply"
        onClick={() => {
          const quoted = comment.body
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n");
          navigator.clipboard.writeText(`${quoted}\n\n`);
          toastManager.add({ title: "Quote copied", type: "success" });
          onClose();
        }}
      />
    </div>
  );
}

function ContextMenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-text-secondary hover:bg-bg-raised hover:text-text-primary flex w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs"
    >
      {icon}
      {label}
    </button>
  );
}
