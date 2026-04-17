import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

export interface FocusModePr {
  number: number;
  title: string;
}

interface FocusModeState {
  active: boolean;
  startedAt: number;
  queue: FocusModePr[];
  currentIndex: number;
  reviewed: number;
  enter: (queue: FocusModePr[]) => void;
  advance: () => FocusModePr | null;
  exit: () => { reviewed: number; total: number; elapsedMs: number };
  setCurrent: (index: number) => void;
}

export const useFocusModeStore = create<FocusModeState>()((set, get) => ({
  active: false,
  startedAt: 0,
  queue: [],
  currentIndex: 0,
  reviewed: 0,

  enter: (queue) => {
    if (queue.length === 0) {
      return;
    }
    set({
      active: true,
      startedAt: Date.now(),
      queue,
      currentIndex: 0,
      reviewed: 0,
    });
  },

  advance: () => {
    const { queue, currentIndex, reviewed } = get();
    const nextIndex = currentIndex + 1;
    if (nextIndex >= queue.length) {
      set({ reviewed: reviewed + 1 });
      return null;
    }
    set({ currentIndex: nextIndex, reviewed: reviewed + 1 });
    return queue[nextIndex] ?? null;
  },

  setCurrent: (index) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) {
      return;
    }
    set({ currentIndex: index });
  },

  exit: () => {
    const { queue, reviewed, startedAt } = get();
    const elapsedMs = Date.now() - startedAt;
    set({
      active: false,
      queue: [],
      currentIndex: 0,
      reviewed: 0,
      startedAt: 0,
    });
    return { reviewed, total: queue.length, elapsedMs };
  },
}));

export function useFocusMode() {
  return useFocusModeStore(useShallow((state) => state));
}

export function formatFocusDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const minsOnly = minutes % 60;
    return `${hours}:${String(minsOnly).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
