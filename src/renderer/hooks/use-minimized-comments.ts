import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { ipc } from "../lib/ipc";

/**
 * Persisted minimized-comment state for a PR.
 * Returns a Set of minimized comment IDs and a toggle function
 * that optimistically updates the UI and persists via IPC.
 */
export function useMinimizedComments(repo: string, prNumber: number) {
  const queryClient = useQueryClient();
  const queryKey = ["minimizedComments", repo, prNumber];

  const { data: minimizedIds = [] } = useQuery({
    queryKey,
    queryFn: () => ipc("comment.getMinimized", { repo, prNumber }),
    staleTime: Infinity,
  });

  const minimizedSet = new Set(minimizedIds);

  const toggleMinimized = useCallback(
    (commentId: string) => {
      const isCurrentlyMinimized = minimizedSet.has(commentId);
      const newMinimized = !isCurrentlyMinimized;

      // Optimistic update
      queryClient.setQueryData<string[]>(queryKey, (old = []) =>
        newMinimized ? [...old, commentId] : old.filter((id) => id !== commentId),
      );

      // Persist
      ipc("comment.setMinimized", { repo, prNumber, commentId, minimized: newMinimized });
    },
    [repo, prNumber, minimizedSet, queryClient, queryKey],
  );

  return { minimizedSet, toggleMinimized };
}
