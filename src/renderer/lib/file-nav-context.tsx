import { type ReactNode, createContext, useCallback, useContext, useState } from "react";

/**
 * Shared state for file navigation between the sidebar file tree
 * and the PR detail diff viewer.
 */

export interface SelectedCommit {
  oid: string;
  message: string;
}

interface FileNavContextValue {
  currentFileIndex: number;
  setCurrentFileIndex: (index: number) => void;
  selectedCommit: SelectedCommit | null;
  setSelectedCommit: (commit: SelectedCommit | null) => void;
}

const FileNavContext = createContext<FileNavContextValue>({
  currentFileIndex: 0,
  setCurrentFileIndex: () => {},
  selectedCommit: null,
  setSelectedCommit: () => {},
});

export function FileNavProvider({ children }: { children: ReactNode }) {
  const [currentFileIndex, setCurrentFileIndexRaw] = useState(0);
  const [selectedCommit, setSelectedCommitRaw] = useState<SelectedCommit | null>(null);

  const setCurrentFileIndex = useCallback((index: number) => {
    setCurrentFileIndexRaw(index);
  }, []);

  const setSelectedCommit = useCallback((commit: SelectedCommit | null) => {
    setSelectedCommitRaw(commit);
    // Reset file index when switching commit view
    setCurrentFileIndexRaw(0);
  }, []);

  return (
    <FileNavContext.Provider
      value={{ currentFileIndex, setCurrentFileIndex, selectedCommit, setSelectedCommit }}
    >
      {children}
    </FileNavContext.Provider>
  );
}

export function useFileNav() {
  return useContext(FileNavContext);
}
