import type { ReactNode } from "react";

import { createContext, useContext } from "react";

interface WorkspaceContextValue {
  /** Absolute path to the active git repository */
  cwd: string;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ cwd, children }: { cwd: string; children: ReactNode }) {
  return <WorkspaceContext.Provider value={{ cwd }}>{children}</WorkspaceContext.Provider>;
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
