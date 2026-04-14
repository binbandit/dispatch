import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { useMutation } from "@tanstack/react-query";
import { FolderOpen, Globe, Trash2 } from "lucide-react";
import { useState } from "react";

interface MissingFolderDialogProps {
  open: boolean;
  onResolved: () => void;
}

/**
 * Shown when the active workspace's linked folder no longer exists on disk.
 * Offers three recovery paths: re-link, go remote-only, or remove workspace.
 */
export function MissingFolderDialog({ open, onResolved }: MissingFolderDialogProps) {
  const { id, nwo, cwd, switchWorkspace, owner, repo } = useWorkspace();
  const [relinkError, setRelinkError] = useState<string | null>(null);

  const relinkMutation = useMutation({
    mutationFn: async () => {
      const picked = await ipc("workspace.pickFolder");
      if (!picked) {
        throw new Error("cancelled");
      }
      return ipc("workspace.addFromFolder", { path: picked });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
      switchWorkspace({ id, owner: result.owner, repo: result.repo, path: result.path });
      setRelinkError(null);
      onResolved();
    },
    onError: (error) => {
      if ((error as Error).message === "cancelled") {
        return;
      }
      setRelinkError((error as Error).message);
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: () => ipc("workspace.unlinkPath", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
      switchWorkspace({ id, owner, repo, path: null });
      onResolved();
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => ipc("workspace.remove", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
      onResolved();
    },
  });

  const isPending =
    relinkMutation.isPending || unlinkMutation.isPending || removeMutation.isPending;

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-[420px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[17px]">Folder not found</AlertDialogTitle>
          <AlertDialogDescription className="text-text-secondary text-[13px] leading-relaxed">
            The local folder for <span className="text-text-primary font-medium">{nwo}</span> no
            longer exists at{" "}
            <code className="bg-bg-raised text-text-secondary rounded px-1.5 py-0.5 font-mono text-[11px]">
              {cwd}
            </code>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2 px-6 pb-2">
          {/* Re-link */}
          <button
            type="button"
            disabled={isPending}
            className="border-border-strong hover:bg-bg-raised group flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => relinkMutation.mutate()}
          >
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
              style={{ background: "rgba(212, 136, 58, 0.10)" }}
            >
              <FolderOpen
                size={15}
                className="text-primary"
              />
            </div>
            <div>
              <p className="text-text-primary text-[13px] font-medium">Link new folder</p>
              <p className="text-text-tertiary text-[11px]">Pick where the repo moved to</p>
            </div>
          </button>

          {/* Remote-only */}
          <button
            type="button"
            disabled={isPending}
            className="border-border-strong hover:bg-bg-raised group flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => unlinkMutation.mutate()}
          >
            <div className="bg-bg-raised flex h-8 w-8 shrink-0 items-center justify-center rounded-md">
              <Globe
                size={15}
                className="text-text-secondary"
              />
            </div>
            <div>
              <p className="text-text-primary text-[13px] font-medium">Continue without folder</p>
              <p className="text-text-tertiary text-[11px]">Use GitHub API only (no local git)</p>
            </div>
          </button>

          {/* Remove */}
          <button
            type="button"
            disabled={isPending}
            className="border-border-strong hover:bg-bg-raised group flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => removeMutation.mutate()}
          >
            <div className="bg-bg-raised flex h-8 w-8 shrink-0 items-center justify-center rounded-md">
              <Trash2
                size={15}
                className="text-text-tertiary"
              />
            </div>
            <div>
              <p className="text-text-primary text-[13px] font-medium">Remove workspace</p>
              <p className="text-text-tertiary text-[11px]">Delete this workspace entirely</p>
            </div>
          </button>
        </div>

        {relinkError && <p className="text-destructive px-6 pb-2 text-[11px]">{relinkError}</p>}

        <AlertDialogFooter variant="bare">
          <AlertDialogClose
            render={
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending}
              />
            }
          >
            Dismiss
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
