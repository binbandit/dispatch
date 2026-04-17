/* eslint-disable import/max-dependencies -- AppLayout intentionally composes the app shell routes and global chrome. */
import type { ReviewResumeState } from "@/shared/ipc/contracts/review";

import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { CommandPalette } from "@/renderer/components/inbox/command-palette";
import { HomeView } from "@/renderer/components/inbox/home-view";
import { MergeQueueView } from "@/renderer/components/inbox/merge-queue-view";
import { MetricsView } from "@/renderer/components/inbox/metrics-view";
import { FocusModeHud } from "@/renderer/components/review/focus-mode-hud";
import { PrDetailView } from "@/renderer/components/review/pr-detail-view";
import { ReviewSidebar } from "@/renderer/components/review/sidebar/review-sidebar";
import { SettingsView } from "@/renderer/components/settings/settings-view";
import { ReleasesView } from "@/renderer/components/workflows/releases-view";
import { WorkflowsDashboard } from "@/renderer/components/workflows/workflows-dashboard";
import { useKeyboardShortcuts } from "@/renderer/hooks/app/use-keyboard-shortcuts";
import { useNotificationPolling } from "@/renderer/hooks/app/use-notification-polling";
import { useWorkspacePathMonitor } from "@/renderer/hooks/app/use-workspace-path-monitor";
import { ipc } from "@/renderer/lib/app/ipc";
import { listenForMainProcessEvents } from "@/renderer/lib/app/posthog";
import { useRouter, useRouterStore, type Route } from "@/renderer/lib/app/router";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { useKeybindings } from "@/renderer/lib/keyboard/keybinding-context";
import { type FileNavState, useFileNavStore } from "@/renderer/lib/review/file-nav-context";
import { useQuery } from "@tanstack/react-query";
import {
  type ReactNode,
  Component,
  type ErrorInfo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { MissingFolderDialog } from "../shared/missing-folder-dialog";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";
import { Navbar } from "./navbar";
import { UpdateBanner } from "./update-banner";

export function AppLayout() {
  const { nwo } = useWorkspace();
  const resumeStateQuery = useQuery({
    queryKey: ["review", "resumeState", nwo],
    queryFn: () => ipc("review.getResumeState", { workspace: nwo }),
    staleTime: 300_000,
  });
  const resumeState = resumeStateQuery.data ?? null;
  const resumeReady = !resumeStateQuery.isLoading;

  const initialRoute = useMemo<Route>(() => {
    if (!resumeState) {
      return { view: "review", prNumber: null };
    }
    if (resumeState.view === "review") {
      return { view: "review", prNumber: resumeState.prNumber };
    }
    if (resumeState.view === "workflows") {
      return { view: "workflows" };
    }
    if (resumeState.view === "metrics") {
      return { view: "metrics" };
    }
    if (resumeState.view === "releases") {
      return { view: "releases" };
    }
    if (resumeState.view === "merge-queue") {
      return { view: "merge-queue" };
    }
    return { view: "settings" };
  }, [resumeState]);

  const initialFileNavState = useMemo<FileNavState | null>(() => {
    if (!resumeState || resumeState.view !== "review") {
      return null;
    }
    return {
      currentFileIndex: resumeState.currentFileIndex,
      currentFilePath: resumeState.currentFilePath,
      selectedCommit: resumeState.selectedCommit,
      diffMode: resumeState.diffMode,
      panelOpen: resumeState.panelOpen,
      panelTab: resumeState.panelTab,
    };
  }, [resumeState]);

  // Reset router and file nav store when workspace or resume state changes
  const resetKey = `${nwo}-${resumeReady ? "ready" : "loading"}`;
  const prevResetKeyRef = useRef(resetKey);

  useEffect(() => {
    if (resetKey === prevResetKeyRef.current) {
      return;
    }
    prevResetKeyRef.current = resetKey;
    useRouterStore.getState().reset(initialRoute);
    useFileNavStore.getState().reset(initialFileNavState ?? undefined);
  }, [resetKey, initialRoute, initialFileNavState]);

  // Set initial route on first mount
  useEffect(() => {
    useRouterStore.getState().reset(initialRoute);
    if (initialFileNavState) {
      useFileNavStore.getState().reset(initialFileNavState);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);

  return (
    <ErrorBoundary>
      <AppShell
        resumeReady={resumeReady}
        resumeState={resumeState}
      />
    </ErrorBoundary>
  );
}

interface AppShellProps {
  resumeState: ReviewResumeState | null;
  resumeReady: boolean;
}

function AppShell({ resumeState, resumeReady }: AppShellProps) {
  const { route, navigate, goBack, goForward, toggleSettings } = useRouter();
  const { nwo } = useWorkspace();
  const { getBinding } = useKeybindings();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const saveStateTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const lastSavedStateRef = useRef<string | null>(null);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => !v);
  }, []);
  const selectedPr = route.view === "review" ? route.prNumber : null;
  const navigateHome = useCallback(() => {
    navigate({ view: "review", prNumber: null });
  }, [navigate]);

  const { pathMissing, dismiss: dismissPathMissing } = useWorkspacePathMonitor();

  useKeyboardShortcuts([
    { ...getBinding("navigation.toggleSidebar"), handler: toggleSidebar },
    { ...getBinding("navigation.back"), handler: goBack },
    { ...getBinding("navigation.forward"), handler: goForward },
    { sequence: ["g", "q"], handler: navigateHome, when: () => selectedPr !== null },
    { ...getBinding("views.shortcuts"), handler: () => setShowShortcuts(true) },
    { ...getBinding("views.review"), handler: navigateHome },
    { ...getBinding("views.workflows"), handler: () => navigate({ view: "workflows" }) },
    { ...getBinding("views.metrics"), handler: () => navigate({ view: "metrics" }) },
    { ...getBinding("views.releases"), handler: () => navigate({ view: "releases" }) },
    { ...getBinding("views.mergeQueue"), handler: () => navigate({ view: "merge-queue" }) },
    { ...getBinding("views.settings"), handler: toggleSettings },
  ]);
  useNotificationPolling();

  useEffect(() => {
    listenForMainProcessEvents();
  }, []);

  useEffect(() => {
    const { api } = globalThis as typeof globalThis & { api: ElectronApi };
    const cleanup = api.onNavigate((trayRoute) => {
      if (trayRoute.view === "settings") {
        navigate({ view: "settings" });
      } else if (trayRoute.view === "review" && trayRoute.prNumber) {
        navigate({ view: "review", prNumber: trayRoute.prNumber });
      }
    });
    return cleanup;
  }, [navigate]);

  useEffect(() => {
    const { api } = globalThis as typeof globalThis & { api: ElectronApi };
    const cleanup = api.onWindowStateChange((state) => {
      setIsFullscreen(state.isFullscreen);
    });
    return cleanup;
  }, []);

  // Refs for latest values — avoids stale closures in debounced persist
  const nwoRef = useRef(nwo);
  nwoRef.current = nwo;
  const routeRef = useRef(route);
  routeRef.current = route;
  const lastReviewPrRef = useRef<number | null>(route.view === "review" ? route.prNumber : null);

  const schedulePersist = useCallback(() => {
    if (!resumeReady) {
      return;
    }

    if (saveStateTimerRef.current !== null) {
      globalThis.clearTimeout(saveStateTimerRef.current);
    }

    saveStateTimerRef.current = globalThis.setTimeout(() => {
      const currentRoute = routeRef.current;
      const currentNwo = nwoRef.current;
      if (currentRoute.view === "review" && currentRoute.prNumber !== null) {
        lastReviewPrRef.current = currentRoute.prNumber;
      }
      const fnState = useFileNavStore.getState().getSnapshot();
      const isReview = currentRoute.view === "review";
      const savedPrNumber = isReview ? currentRoute.prNumber : lastReviewPrRef.current;

      const nextState: Omit<ReviewResumeState, "updatedAt"> = {
        workspace: currentNwo,
        view: currentRoute.view,
        prNumber: savedPrNumber,
        currentFilePath: fnState.currentFilePath,
        currentFileIndex: fnState.currentFileIndex,
        diffMode: fnState.diffMode,
        panelOpen: fnState.panelOpen,
        panelTab: fnState.panelTab,
        selectedCommit: fnState.selectedCommit,
      };

      const serialized = JSON.stringify(nextState);
      if (serialized === lastSavedStateRef.current) {
        return;
      }

      void ipc("review.saveResumeState", nextState)
        .then(() => {
          lastSavedStateRef.current = serialized;
        })
        .catch(() => {});
    }, 250);
  }, [resumeReady]);

  // Reset file nav state when PR changes
  useEffect(() => {
    if (!resumeReady || route.view !== "review") {
      return;
    }

    if (selectedPr === null) {
      lastReviewPrRef.current = null;
      useFileNavStore.getState().reset();
      return;
    }

    if (lastReviewPrRef.current === selectedPr) {
      return;
    }

    if (resumeState?.prNumber === selectedPr) {
      lastReviewPrRef.current = selectedPr;
      useFileNavStore.getState().reset({
        currentFileIndex: resumeState.currentFileIndex,
        currentFilePath: resumeState.currentFilePath,
        selectedCommit: resumeState.selectedCommit,
        diffMode: resumeState.diffMode,
        panelOpen: resumeState.panelOpen,
        panelTab: resumeState.panelTab,
      });
      return;
    }

    lastReviewPrRef.current = selectedPr;
    useFileNavStore.getState().reset();
  }, [route.view, resumeReady, resumeState, selectedPr]);

  // Subscribe to file nav store changes for persistence
  useEffect(() => {
    if (!resumeReady) {
      return;
    }
    const unsub = useFileNavStore.subscribe(() => {
      schedulePersist();
    });
    return unsub;
  }, [resumeReady, schedulePersist]);

  // Persist when route or workspace changes
  useEffect(() => {
    if (!resumeReady) {
      return;
    }
    schedulePersist();
    return () => {
      if (saveStateTimerRef.current !== null) {
        globalThis.clearTimeout(saveStateTimerRef.current);
      }
    };
  }, [nwo, route.view, selectedPr, resumeReady, schedulePersist]);

  return (
    <div
      className="bg-bg-root text-text-primary relative flex h-screen flex-col overflow-hidden"
      style={{ background: "var(--app-shell-background, var(--bg-root))" }}
    >
      <a
        href="#app-main"
        className="bg-bg-elevated text-text-primary border-border-strong absolute top-3 left-3 z-50 -translate-y-2 rounded-md border px-3 py-2 text-xs font-medium opacity-0 shadow-[var(--shadow-md)] transition-[opacity,transform] duration-[120ms] ease-out focus-visible:translate-y-0 focus-visible:opacity-100 focus-visible:outline-none"
      >
        Skip to main content
      </a>

      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          opacity: "var(--noise-opacity, 0.015)",
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "256px 256px",
        }}
      />

      <UpdateBanner
        onVisibilityChange={setBannerVisible}
        isFullscreen={isFullscreen}
      />

      <div
        className="w-full shrink-0"
        style={{
          height: "var(--accent-bar-height, 2px)",
          background:
            "var(--accent-bar-background, linear-gradient(90deg, transparent, var(--primary), transparent))",
          opacity: "var(--accent-bar-opacity, 0.4)",
        }}
      />

      <Navbar
        bannerVisible={bannerVisible}
        isFullscreen={isFullscreen}
      />

      <main
        id="app-main"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {route.view === "review" && !selectedPr && <HomeView />}

        {route.view === "review" && selectedPr && (
          <ResizablePanelGroup
            orientation="horizontal"
            className="flex-1"
          >
            {!sidebarCollapsed && (
              <>
                <ResizablePanel
                  defaultSize="20%"
                  minSize="12%"
                  maxSize="35%"
                >
                  <ReviewSidebar
                    prNumber={selectedPr}
                    onBack={navigateHome}
                    onSelectPr={(pr) => navigate({ view: "review", prNumber: pr })}
                  />
                </ResizablePanel>
                <ResizableHandle />
              </>
            )}
            <ResizablePanel>
              <section
                aria-label="Pull request detail"
                className="flex h-full flex-col overflow-hidden"
              >
                <PrDetailView prNumber={selectedPr} />
              </section>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}

        {route.view === "workflows" && <WorkflowsDashboard />}

        {route.view === "metrics" && <MetricsView />}

        {route.view === "releases" && <ReleasesView />}

        {route.view === "merge-queue" && <MergeQueueView />}

        {route.view === "settings" && <SettingsView />}
      </main>

      <KeyboardShortcutsDialog
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />

      <CommandPalette />

      <FocusModeHud />

      <MissingFolderDialog
        open={pathMissing}
        onResolved={dismissPathMissing}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error Boundary
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("Uncaught error:", error, info);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="bg-bg-root flex h-screen flex-col items-center justify-center gap-4">
          <h1 className="font-heading text-text-primary text-3xl font-bold italic">
            Something went wrong
          </h1>
          <p className="text-text-secondary max-w-md text-center text-[13px]">
            {this.state.error.message}
          </p>
          <Button
            size="xs"
            onClick={() => {
              this.setState({ error: null });
            }}
            className="bg-primary text-primary-foreground hover:bg-accent-hover"
          >
            Try again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
