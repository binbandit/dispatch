/* eslint-disable import/max-dependencies -- The app shell owns the top-level route and layout composition for the renderer. */
import type { ReviewResumeState } from "@/shared/ipc/contracts/review";

import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { CommandPalette } from "@/renderer/components/inbox/command-palette";
import { HomeView } from "@/renderer/components/inbox/home-view";
import { MetricsView } from "@/renderer/components/inbox/metrics-view";
import { PrDetailView } from "@/renderer/components/review/pr-detail-view";
import { ReviewSidebar } from "@/renderer/components/review/sidebar/review-sidebar";
import { SettingsView } from "@/renderer/components/settings/settings-view";
import { ReleasesView } from "@/renderer/components/workflows/releases-view";
import { WorkflowsDashboard } from "@/renderer/components/workflows/workflows-dashboard";
import { useKeyboardShortcuts } from "@/renderer/hooks/app/use-keyboard-shortcuts";
import { useNotificationPolling } from "@/renderer/hooks/app/use-notification-polling";
import { useWorkspacePathMonitor } from "@/renderer/hooks/app/use-workspace-path-monitor";
import { CommandPaletteProvider } from "@/renderer/lib/app/command-palette-context";
import { ipc } from "@/renderer/lib/app/ipc";
import { listenForMainProcessEvents } from "@/renderer/lib/app/posthog";
import { RouterProvider, useRouter, type Route } from "@/renderer/lib/app/router";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { useKeybindings } from "@/renderer/lib/keyboard/keybinding-context";
import {
  DEFAULT_FILE_NAV_STATE,
  type FileNavState,
  FileNavProvider,
} from "@/renderer/lib/review/file-nav-context";
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

/**
 * Root layout — DISPATCH-DESIGN-SYSTEM.md § 4.2
 *
 * Now with client-side routing: Review | Workflows | Settings
 */
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

  return (
    <RouterProvider
      key={`${nwo}-${resumeReady ? "ready" : "loading"}`}
      initialRoute={initialRoute}
    >
      <ErrorBoundary>
        <AppShell
          resumeReady={resumeReady}
          resumeState={resumeState}
          initialFileNavState={initialFileNavState}
        />
      </ErrorBoundary>
    </RouterProvider>
  );
}

interface AppShellProps {
  resumeState: ReviewResumeState | null;
  resumeReady: boolean;
  initialFileNavState: FileNavState | null;
}

function AppShell({ resumeState, resumeReady, initialFileNavState }: AppShellProps) {
  const { route, navigate, toggleSettings } = useRouter();
  const { nwo } = useWorkspace();
  const { getBinding } = useKeybindings();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fileNavState, setFileNavState] = useState<FileNavState>(
    initialFileNavState ?? DEFAULT_FILE_NAV_STATE,
  );
  const reviewSeedRef = useRef<string | null>(null);
  const saveStateTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const lastSavedStateRef = useRef<string | null>(null);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => !v);
  }, []);

  const { pathMissing, dismiss: dismissPathMissing } = useWorkspacePathMonitor();

  useKeyboardShortcuts([
    { ...getBinding("navigation.toggleSidebar"), handler: toggleSidebar },
    { ...getBinding("views.shortcuts"), handler: () => setShowShortcuts(true) },
    { ...getBinding("views.review"), handler: () => navigate({ view: "review", prNumber: null }) },
    { ...getBinding("views.workflows"), handler: () => navigate({ view: "workflows" }) },
    { ...getBinding("views.metrics"), handler: () => navigate({ view: "metrics" }) },
    { ...getBinding("views.releases"), handler: () => navigate({ view: "releases" }) },
    { ...getBinding("views.settings"), handler: toggleSettings },
  ]);
  useNotificationPolling();

  // Forward analytics events from main process to PostHog
  useEffect(() => {
    listenForMainProcessEvents();
  }, []);

  // Listen for navigation events from main process (tray menu, notification clicks)
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

  const selectedPr = route.view === "review" ? route.prNumber : null;

  useEffect(() => {
    if (!resumeReady || route.view !== "review") {
      return;
    }

    const seedKey = selectedPr === null ? "review-home" : `review-pr-${selectedPr}`;
    if (seedKey === reviewSeedRef.current) {
      return;
    }
    reviewSeedRef.current = seedKey;

    if (selectedPr === null) {
      setFileNavState(DEFAULT_FILE_NAV_STATE);
      return;
    }

    if (resumeState?.view === "review" && resumeState.prNumber === selectedPr) {
      setFileNavState({
        currentFileIndex: resumeState.currentFileIndex,
        currentFilePath: resumeState.currentFilePath,
        selectedCommit: resumeState.selectedCommit,
        diffMode: resumeState.diffMode,
        panelOpen: resumeState.panelOpen,
        panelTab: resumeState.panelTab,
      });
      return;
    }

    setFileNavState(DEFAULT_FILE_NAV_STATE);
  }, [route.view, resumeReady, resumeState, selectedPr]);

  useEffect(() => {
    if (!resumeReady) {
      return;
    }

    const nextState: Omit<ReviewResumeState, "updatedAt"> = {
      workspace: nwo,
      view: route.view,
      prNumber: route.view === "review" ? route.prNumber : null,
      currentFilePath: route.view === "review" ? fileNavState.currentFilePath : null,
      currentFileIndex: route.view === "review" ? fileNavState.currentFileIndex : 0,
      diffMode: route.view === "review" ? fileNavState.diffMode : "all",
      panelOpen: route.view === "review" ? fileNavState.panelOpen : true,
      panelTab: route.view === "review" ? fileNavState.panelTab : "overview",
      selectedCommit: route.view === "review" ? fileNavState.selectedCommit : null,
    };

    const serialized = JSON.stringify(nextState);
    if (serialized === lastSavedStateRef.current) {
      return;
    }

    if (saveStateTimerRef.current !== null) {
      globalThis.clearTimeout(saveStateTimerRef.current);
    }

    saveStateTimerRef.current = globalThis.setTimeout(() => {
      void ipc("review.saveResumeState", nextState)
        .then(() => {
          lastSavedStateRef.current = serialized;
        })
        .catch(() => {});
    }, 250);

    return () => {
      if (saveStateTimerRef.current !== null) {
        globalThis.clearTimeout(saveStateTimerRef.current);
      }
    };
  }, [fileNavState, nwo, route.view, resumeReady, selectedPr]);

  return (
    <CommandPaletteProvider>
      <div className="bg-bg-root text-text-primary relative flex h-screen flex-col overflow-hidden">
        {/* Background noise texture (§ 4.4) */}
        <div
          className="pointer-events-none fixed inset-0 z-0"
          style={{
            opacity: 0.015,
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
            backgroundRepeat: "repeat",
            backgroundSize: "256px 256px",
          }}
        />

        {/* Update banner */}
        <UpdateBanner
          onVisibilityChange={setBannerVisible}
          isFullscreen={isFullscreen}
        />

        {/* Accent bar */}
        <div
          className="h-[2px] w-full shrink-0"
          style={{
            background: "linear-gradient(90deg, transparent, var(--primary), transparent)",
            opacity: 0.4,
          }}
        />

        {/* Navbar */}
        <Navbar
          bannerVisible={bannerVisible}
          isFullscreen={isFullscreen}
        />

        {/* View content */}
        {route.view === "review" && !selectedPr && <HomeView />}

        {route.view === "review" && selectedPr && (
          <FileNavProvider
            key={selectedPr}
            initialState={fileNavState}
            onStateChange={setFileNavState}
          >
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
                      onBack={() => navigate({ view: "review", prNumber: null })}
                      onSelectPr={(pr) => navigate({ view: "review", prNumber: pr })}
                    />
                  </ResizablePanel>
                  <ResizableHandle />
                </>
              )}
              <ResizablePanel>
                <main className="flex h-full flex-col overflow-hidden">
                  <PrDetailView prNumber={selectedPr} />
                </main>
              </ResizablePanel>
            </ResizablePanelGroup>
          </FileNavProvider>
        )}

        {route.view === "workflows" && <WorkflowsDashboard />}

        {route.view === "metrics" && <MetricsView />}

        {route.view === "releases" && <ReleasesView />}

        {route.view === "settings" && <SettingsView />}

        {/* Keyboard shortcuts dialog */}
        <KeyboardShortcutsDialog
          open={showShortcuts}
          onClose={() => setShowShortcuts(false)}
        />

        {/* Command palette (⌘K) */}
        <CommandPalette />

        {/* Missing folder recovery dialog */}
        <MissingFolderDialog
          open={pathMissing}
          onResolved={dismissPathMissing}
        />
      </div>
    </CommandPaletteProvider>
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
