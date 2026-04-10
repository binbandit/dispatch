/* eslint-disable import/max-dependencies -- App bootstrap intentionally composes the top-level providers and boot flow in one entrypoint. */
import type { Workspace } from "@/shared/ipc";

import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { EnvCheck } from "./components/setup/env-check";
import { Onboarding } from "./components/setup/onboarding";
import { AppLayout } from "./components/shell/app-layout";
import { SplashScreen } from "./components/shell/splash-screen";
import { ipc } from "./lib/app/ipc";
import { initPostHog } from "./lib/app/posthog";
import { queryClient } from "./lib/app/query-client";
import { ThemeProvider } from "./lib/app/theme-context";
import { WorkspaceProvider } from "./lib/app/workspace-context";
import { KeybindingProvider } from "./lib/keyboard/keybinding-context";

/**
 * Boot flow:
 *
 * 1. Splash screen is ALWAYS mounted (never unmounts/remounts).
 * 2. Queries fire immediately behind the splash.
 * 3. Once the splash animation finishes AND data has loaded at least once,
 *    we set `showApp = true` and the splash fades out.
 * 4. `showApp` is a one-way latch — once true, splash never comes back.
 */

function AppContent() {
  const [splashAnimDone, setSplashAnimDone] = useState(false);
  const [showApp, setShowApp] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const dataLoadedOnce = useRef(false);

  // Fire ALL queries immediately — they resolve during the splash
  const envQuery = useQuery({
    queryKey: ["env", "check"],
    queryFn: () => ipc("env.check"),
  });
  const activeQuery = useQuery({
    queryKey: ["workspace", "active"],
    queryFn: () => ipc("workspace.active"),
  });
  const workspacesQuery = useQuery({
    queryKey: ["workspace", "list"],
    queryFn: () => ipc("workspace.list"),
  });

  const dataReady = !envQuery.isLoading && !activeQuery.isLoading && !workspacesQuery.isLoading;

  // One-way latch: once data has loaded, remember it forever
  if (dataReady && !dataLoadedOnce.current) {
    dataLoadedOnce.current = true;
  }

  // Transition from splash → app once both conditions are met (via useEffect, not during render)
  useEffect(() => {
    if (splashAnimDone && dataLoadedOnce.current && !showApp) {
      setShowApp(true);
    }
  }, [splashAnimDone, dataReady, showApp]);

  const handleSplashComplete = useCallback(() => {
    setSplashAnimDone(true);
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    setOnboardingComplete(true);
    queryClient.invalidateQueries({ queryKey: ["workspace"] });
  }, []);

  const handleRetryEnvCheck = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["env", "check"] });
  }, []);

  // Determine which screen to show (only matters when showApp is true)
  const phase = resolvePhase({
    envData: envQuery.data ?? null,
    activeWorkspace: activeQuery.data ?? null,
    workspaces: workspacesQuery.data ?? [],
    onboardingComplete,
  });

  return (
    <>
      {/* Splash is always mounted — fades out via CSS, then hidden */}
      <SplashScreen
        onComplete={handleSplashComplete}
        visible={!showApp}
      />

      {/* App content renders behind the splash, becomes visible when showApp */}
      {showApp && (
        <AppScreen
          phase={phase}
          envData={envQuery.data ?? null}
          activeWorkspace={activeQuery.data ?? null}
          workspaces={workspacesQuery.data ?? []}
          onOnboardingComplete={handleOnboardingComplete}
          onRetryEnvCheck={handleRetryEnvCheck}
        />
      )}
    </>
  );
}

type AppPhase = "env-error" | "onboarding" | "ready";

function resolvePhase({
  envData,
  activeWorkspace,
  workspaces,
  onboardingComplete,
}: {
  envData: { ghVersion: string | null; gitVersion: string | null; ghAuth: boolean } | null;
  activeWorkspace: { id: number } | null;
  workspaces: Workspace[];
  onboardingComplete: boolean;
}): AppPhase {
  if (envData && (!envData.ghVersion || !envData.gitVersion || !envData.ghAuth)) {
    return "env-error";
  }

  if (workspaces.length === 0 && !onboardingComplete) {
    return "onboarding";
  }

  if (activeWorkspace || workspaces.length > 0) {
    return "ready";
  }

  return "onboarding";
}

function AppScreen({
  phase,
  envData,
  activeWorkspace,
  workspaces,
  onOnboardingComplete,
  onRetryEnvCheck,
}: {
  phase: AppPhase;
  envData: { ghVersion: string | null; gitVersion: string | null; ghAuth: boolean } | null;
  activeWorkspace: {
    id: number;
    owner: string;
    repo: string;
    path: string | null;
    name: string;
  } | null;
  workspaces: Workspace[];
  onOnboardingComplete: () => void;
  onRetryEnvCheck: () => void;
}) {
  switch (phase) {
    case "env-error": {
      return (
        <EnvCheck
          ghVersion={envData?.ghVersion ?? null}
          gitVersion={envData?.gitVersion ?? null}
          ghAuth={envData?.ghAuth ?? false}
          onRetry={onRetryEnvCheck}
        />
      );
    }
    case "onboarding": {
      return <Onboarding onComplete={onOnboardingComplete} />;
    }
    case "ready": {
      const ws = activeWorkspace ?? workspaces[0];
      if (!ws) {
        return <Onboarding onComplete={onOnboardingComplete} />;
      }
      // Initialize PostHog analytics (opt-in only)
      initPostHog().catch(() => {});
      return (
        <WorkspaceProvider workspace={ws}>
          <AppLayout />
        </WorkspaceProvider>
      );
    }
  }
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <KeybindingProvider>
            <ToastProvider position="bottom-right">
              <AppContent />
            </ToastProvider>
          </KeybindingProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
