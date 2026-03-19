import type { ReactNode } from "react";

import { createContext, useCallback, useContext, useRef, useState } from "react";

import { trackPage } from "./posthog";

/**
 * Simple state-based client-side router.
 *
 * Tracks the previous non-settings route so the settings icon
 * can toggle back to where you came from.
 */

export type Route =
  | { view: "review"; prNumber: number | null }
  | { view: "workflows" }
  | { view: "metrics" }
  | { view: "releases" }
  | { view: "settings" };

interface RouterContextValue {
  route: Route;
  navigate: (route: Route) => void;
  /** Navigate to settings, or back to the previous view if already on settings. */
  toggleSettings: () => void;
}

const RouterContext = createContext<RouterContextValue>({
  route: { view: "review", prNumber: null },
  navigate: () => {},
  toggleSettings: () => {},
});

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>({ view: "review", prNumber: null });
  const previousRoute = useRef<Route>({ view: "review", prNumber: null });

  const navigate = useCallback((next: Route) => {
    setRoute((current) => {
      if (current.view !== "settings") {
        previousRoute.current = current;
      }
      return next;
    });
    trackPage(next.view);
  }, []);

  const toggleSettings = useCallback(() => {
    setRoute((current) => {
      if (current.view === "settings") {
        // Go back to previous view
        return previousRoute.current;
      }
      // Going to settings — save current route
      previousRoute.current = current;
      return { view: "settings" };
    });
  }, []);

  return (
    <RouterContext.Provider value={{ route, navigate, toggleSettings }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter() {
  return useContext(RouterContext);
}
