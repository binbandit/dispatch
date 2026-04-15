import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

export interface PendingComment {
  id: string;
  filePath: string;
  line: number;
  side: "LEFT" | "RIGHT";
  startLine?: number;
  startSide?: "LEFT" | "RIGHT";
  body: string;
}

interface PendingReviewState {
  /** Pending comments keyed by PR number */
  commentsByPr: Record<number, PendingComment[]>;
  addComment: (prNumber: number, comment: Omit<PendingComment, "id">) => void;
  removeComment: (prNumber: number, commentId: string) => void;
  clearComments: (prNumber: number) => void;
}

let nextId = 0;

export const usePendingReviewStore = create<PendingReviewState>()((set) => ({
  commentsByPr: {},

  addComment: (prNumber, comment) =>
    set((state) => {
      const existing = state.commentsByPr[prNumber] ?? [];
      return {
        commentsByPr: {
          ...state.commentsByPr,
          [prNumber]: [...existing, { ...comment, id: String(++nextId) }],
        },
      };
    }),

  removeComment: (prNumber, commentId) =>
    set((state) => {
      const existing = state.commentsByPr[prNumber] ?? [];
      return {
        commentsByPr: {
          ...state.commentsByPr,
          [prNumber]: existing.filter((c) => c.id !== commentId),
        },
      };
    }),

  clearComments: (prNumber) =>
    set((state) => {
      const { [prNumber]: _, ...rest } = state.commentsByPr;
      return { commentsByPr: rest };
    }),
}));

export function usePendingComments(prNumber: number): PendingComment[] {
  return usePendingReviewStore(useShallow((s) => s.commentsByPr[prNumber] ?? []));
}

export function usePendingReviewActions() {
  return usePendingReviewStore(
    useShallow((s) => ({
      addComment: s.addComment,
      removeComment: s.removeComment,
      clearComments: s.clearComments,
    })),
  );
}
