import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useState } from "react";

import { useKeyboardShortcuts } from "../hooks/use-keyboard-shortcuts";
import { useNotificationPolling } from "../hooks/use-notification-polling";
import { FileNavProvider } from "../lib/file-nav-context";
import { useKeybindings } from "../lib/keybinding-context";
import { listenForMainProcessEvents } from "../lib/posthog";
import { RouterProvider, useRouter } from "../lib/router";
import { useWorkspace } from "../lib/workspace-context";
import { AcpPermissionListener } from "./acp-permission-dialog";
import { CommandPalette } from "./command-palette";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";
import { MetricsView } from "./metrics-view";
import { Navbar } from "./navbar";
import { PrDetailView } from "./pr-detail-view";
import { PrInbox } from "./pr-inbox";
import { ReleasesView } from "./releases-view";
import { ReviewSidebar } from "./review-sidebar";
import { SettingsView } from "./settings-view";
import { UpdateBanner } from "./update-banner";
import { WorkflowsDashboard } from "./workflows-dashboard";

/**
 * Root layout — DISPATCH-DESIGN-SYSTEM.md § 4.2
 *
 * Now with client-side routing: Review | Workflows | Settings
 */
export function AppLayout() {
  return (
    <RouterProvider>
      <ErrorBoundary>
        <AppShell />
      </ErrorBoundary>
    </RouterProvider>
  );
}

function AppShell() {
  const { route, navigate } = useRouter();
  const { switchWorkspace } = useWorkspace();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(false);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => !v);
  }, []);

  const { getBinding } = useKeybindings();

  useKeyboardShortcuts([
    { ...getBinding("navigation.toggleSidebar"), handler: toggleSidebar },
    { ...getBinding("views.shortcuts"), handler: () => setShowShortcuts(true) },
    { ...getBinding("views.review"), handler: () => navigate({ view: "review", prNumber: null }) },
    { ...getBinding("views.workflows"), handler: () => navigate({ view: "workflows" }) },
    { ...getBinding("views.metrics"), handler: () => navigate({ view: "metrics" }) },
    { ...getBinding("views.releases"), handler: () => navigate({ view: "releases" }) },
  ]);
  useNotificationPolling();

  // Forward analytics events from main process to PostHog
  useEffect(() => listenForMainProcessEvents(), []);

  // Listen for navigation events from main process (tray menu, notification clicks)
  useEffect(() => {
    const { api } = globalThis as typeof globalThis & { api: ElectronApi };
    const cleanup = api.onNavigate((trayRoute) => {
      if (trayRoute.workspacePath) {
        switchWorkspace(trayRoute.workspacePath);
      }
      if (trayRoute.view === "settings") {
        navigate({ view: "settings" });
      } else if (trayRoute.view === "review" && trayRoute.prNumber) {
        navigate({ view: "review", prNumber: trayRoute.prNumber });
      }
    });
    return cleanup;
  }, [navigate, switchWorkspace]);

  const selectedPr = route.view === "review" ? route.prNumber : null;

  return (
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
      <UpdateBanner onVisibilityChange={setBannerVisible} />

      {/* Accent bar */}
      <div
        className="h-[2px] w-full shrink-0"
        style={{
          background: "linear-gradient(90deg, transparent, var(--primary), transparent)",
          opacity: 0.4,
        }}
      />

      {/* Navbar */}
      <Navbar bannerVisible={bannerVisible} />

      {/* View content */}
      {route.view === "review" && (
        <FileNavProvider>
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
                  {selectedPr ? (
                    <ReviewSidebar
                      prNumber={selectedPr}
                      onBack={() => navigate({ view: "review", prNumber: null })}
                      onSelectPr={(pr) => navigate({ view: "review", prNumber: pr })}
                    />
                  ) : (
                    <PrInbox
                      selectedPr={selectedPr}
                      onSelectPr={(pr) => {
                        navigate({ view: "review", prNumber: pr });
                      }}
                    />
                  )}
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

      {/* ACP agent permission requests */}
      <AcpPermissionListener />
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
