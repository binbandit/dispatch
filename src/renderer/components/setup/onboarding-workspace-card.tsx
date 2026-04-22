import type { Workspace } from "@/shared/ipc";

import { GitBranch, Trash2 } from "lucide-react";

interface WorkspaceCardProps {
  workspace: Workspace;
  onRemove: () => void;
}

export function WorkspaceCard({ workspace, onRemove }: WorkspaceCardProps) {
  return (
    <div className="border-border bg-bg-raised flex items-center gap-3 rounded-lg border px-4 py-3">
      <GitBranch
        size={16}
        className="text-primary shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="text-text-primary text-sm font-medium">
          {workspace.owner}/{workspace.repo}
        </p>
        {workspace.path ? (
          <p className="text-text-tertiary truncate font-mono text-[11px]">{workspace.path}</p>
        ) : (
          <p className="text-text-ghost text-[11px]">Remote only</p>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="text-text-tertiary hover:bg-bg-elevated hover:text-destructive flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}
