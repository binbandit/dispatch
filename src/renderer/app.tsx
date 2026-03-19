import { ToastProvider } from "@/components/ui/toast";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { AppLayout } from "./components/app-layout";
import { EnvCheck } from "./components/env-check";
import { Onboarding } from "./components/onboarding";
import { SplashScreen } from "./components/splash-screen";
import { ipc } from "./lib/ipc";
import { initPostHog } from "./lib/posthog";
import { queryClient } from "./lib/query-client";
import { WorkspaceProvider } from "./lib/workspace-context";

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
  }, [splashAnimDone, showApp]);

  const handleSplashComplete = useCallback(() => {
    setSplashAnimDone(true);
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    setOnboardingComplete(true);
    queryClient.invalidateQueries({ queryKey: ["workspace"] });
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
  activeWorkspace: string | null;
  workspaces: Array<{ path: string }>;
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
}: {
  phase: AppPhase;
  envData: { ghVersion: string | null; gitVersion: string | null; ghAuth: boolean } | null;
  activeWorkspace: string | null;
  workspaces: Array<{ path: string }>;
  onOnboardingComplete: () => void;
}) {
  switch (phase) {
    case "env-error": {
      return (
        <EnvCheck
          ghVersion={envData?.ghVersion ?? null}
          gitVersion={envData?.gitVersion ?? null}
          ghAuth={envData?.ghAuth ?? false}
        />
      );
    }
    case "onboarding": {
      return <Onboarding onComplete={onOnboardingComplete} />;
    }
    case "ready": {
      const cwd = activeWorkspace ?? workspaces[0]?.path ?? "";
      // Initialize PostHog analytics (opt-in only)
      initPostHog().catch(() => {});
      return (
        <WorkspaceProvider cwd={cwd}>
          <AppLayout />
        </WorkspaceProvider>
      );
    }
  }
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider position="bottom-right">
        <AppContent />
      </ToastProvider>
    </QueryClientProvider>
  );
}
