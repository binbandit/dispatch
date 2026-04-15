import { trackPage } from "@/renderer/lib/app/posthog";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

export type Route =
  | { view: "review"; prNumber: number | null }
  | { view: "workflows"; runId?: number; fromPr?: number }
  | { view: "metrics" }
  | { view: "releases" }
  | { view: "merge-queue" }
  | { view: "settings" };

interface RouterState {
  route: Route;
  navigate: (route: Route) => void;
  goBack: () => void;
  goForward: () => void;
  toggleSettings: () => void;
  reset: (route: Route) => void;
}

let previousRoute: Route = { view: "review", prNumber: null };
let backStack: Route[] = [];
let forwardStack: Route[] = [];

function isSameRoute(left: Route, right: Route): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function trackIfViewChanged(current: Route, next: Route): void {
  if (next.view !== current.view) {
    trackPage(next.view);
  }
}

export const useRouterStore = create<RouterState>()((set, get) => ({
  route: { view: "review", prNumber: null } as Route,

  navigate: (next) => {
    const current = get().route;
    if (isSameRoute(current, next)) {
      return;
    }
    if (current.view !== "settings") {
      previousRoute = current;
    }
    backStack.push(current);
    forwardStack = [];
    set({ route: next });
    trackIfViewChanged(current, next);
  },

  goBack: () => {
    const current = get().route;
    const next = backStack.pop();
    if (!next) {
      return;
    }
    if (current.view !== "settings") {
      previousRoute = current;
    }
    forwardStack.push(current);
    set({ route: next });
    trackIfViewChanged(current, next);
  },

  goForward: () => {
    const current = get().route;
    const next = forwardStack.pop();
    if (!next) {
      return;
    }
    if (current.view !== "settings") {
      previousRoute = current;
    }
    backStack.push(current);
    set({ route: next });
    trackIfViewChanged(current, next);
  },

  toggleSettings: () => {
    const current = get().route;
    if (current.view === "settings") {
      const prev = previousRoute;
      const next: Route = prev.view === "settings" ? { view: "review", prNumber: null } : prev;
      if (isSameRoute(current, next)) {
        return;
      }
      backStack.push(current);
      forwardStack = [];
      set({ route: next });
      trackPage(next.view);
    } else {
      previousRoute = current;
      backStack.push(current);
      forwardStack = [];
      set({ route: { view: "settings" } });
      trackPage("settings");
    }
  },

  reset: (route) => {
    previousRoute = { view: "review", prNumber: null };
    backStack = [];
    forwardStack = [];
    set({ route });
    trackPage(route.view);
  },
}));

export function useRouter() {
  return useRouterStore(useShallow((s) => s));
}
