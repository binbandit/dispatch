import type { RepoTarget } from "@/shared/ipc";

import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { type ReactNode, useEffect } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

interface WorkspaceData {
  id: number;
  owner: string;
  repo: string;
  path: string | null;
}

interface WorkspaceState {
  id: number;
  owner: string;
  repo: string;
  nwo: string;
  cwd: string | null;
  hasLocalClone: boolean;
  repoTarget: RepoTarget;
  _initialized: boolean;
  setWorkspace: (ws: WorkspaceData) => void;
  switchWorkspace: (ws: WorkspaceData) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  id: 0,
  owner: "",
  repo: "",
  nwo: "",
  cwd: null,
  hasLocalClone: false,
  repoTarget: { cwd: null, owner: "", repo: "" },
  _initialized: false,

  setWorkspace: (ws) => {
    const nwo = `${ws.owner}/${ws.repo}`;
    set({
      id: ws.id,
      owner: ws.owner,
      repo: ws.repo,
      nwo,
      cwd: ws.path,
      hasLocalClone: ws.path !== null,
      repoTarget: { cwd: ws.path, owner: ws.owner, repo: ws.repo },
      _initialized: true,
    });
  },

  switchWorkspace: (next) => {
    if (next.id === get().id) {return;}

    void ipc("workspace.setActive", { id: next.id })
      .then(() => {
        get().setWorkspace(next);
      })
      .catch(() => {
        void queryClient.invalidateQueries({ queryKey: ["workspace"] });
      });
  },
}));

export function WorkspaceProvider({
  workspace,
  children,
}: {
  workspace: WorkspaceData;
  children: ReactNode;
}) {
  const initialized = useWorkspaceStore((s) => s._initialized);

  useEffect(() => {
    useWorkspaceStore.getState().setWorkspace(workspace);
  }, [workspace.id, workspace.owner, workspace.repo, workspace.path]);

  if (!initialized) {return null;}
  return <>{children}</>;
}

export function useWorkspace() {
  return useWorkspaceStore(
    useShallow((s) => ({
      id: s.id,
      owner: s.owner,
      repo: s.repo,
      nwo: s.nwo,
      cwd: s.cwd,
      hasLocalClone: s.hasLocalClone,
      repoTarget: s.repoTarget,
      switchWorkspace: s.switchWorkspace,
    })),
  );
}
