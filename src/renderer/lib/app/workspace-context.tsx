import type { RepoTarget } from "@/shared/ipc";

import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

interface WorkspaceContextValue {
  /** Workspace database ID */
  id: number;
  /** GitHub owner (always available) */
  owner: string;
  /** GitHub repo name (always available) */
  repo: string;
  /** "owner/repo" convenience string */
  nwo: string;
  /** Absolute path to local git clone, or null for remote-only workspaces */
  cwd: string | null;
  /** Whether this workspace has a local clone linked */
  hasLocalClone: boolean;
  /** RepoTarget object to spread into IPC args */
  repoTarget: RepoTarget;
  /** Switch to a different workspace */
  switchWorkspace: (workspace: {
    id: number;
    owner: string;
    repo: string;
    path: string | null;
  }) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  workspace,
  children,
}: {
  workspace: { id: number; owner: string; repo: string; path: string | null };
  children: ReactNode;
}) {
  const [current, setCurrent] = useState(workspace);

  const switchWorkspace = useCallback(
    (next: { id: number; owner: string; repo: string; path: string | null }) => {
      if (next.id === current.id) {
        return;
      }

      void ipc("workspace.setActive", { id: next.id })
        .then(() => {
          setCurrent(next);
        })
        .catch(() => {
          void queryClient.invalidateQueries({ queryKey: ["workspace"] });
        });
    },
    [current.id],
  );

  const value = useMemo<WorkspaceContextValue>(() => {
    const nwo = `${current.owner}/${current.repo}`;
    return {
      id: current.id,
      owner: current.owner,
      repo: current.repo,
      nwo,
      cwd: current.path,
      hasLocalClone: current.path !== null,
      repoTarget: { cwd: current.path, owner: current.owner, repo: current.repo },
      switchWorkspace,
    };
  }, [current, switchWorkspace]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/**
 * Access the active workspace. Must be used inside WorkspaceProvider.
 */
export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used inside WorkspaceProvider");
  }
  return ctx;
}
