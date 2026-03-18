import { ToastProvider } from "@/components/ui/toast";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { AppLayout } from "./components/app-layout";
import { EnvCheck } from "./components/env-check";
import { Onboarding } from "./components/onboarding";
import { SplashScreen } from "./components/splash-screen";
import { queryClient, trpc } from "./lib/trpc";
import { WorkspaceProvider } from "./lib/workspace-context";

/**
 * App boot flow (single splash screen):
 *
 * 1. Show splash while ALL initialization happens in parallel
 *    (env check + workspace queries fire immediately)
 * 2. Splash holds for a minimum of 1.2s (for the animation)
 * 3. Once splash is done AND data is loaded → route to the right screen
 *    - Missing gh/git → env error screen
 *    - No repos configured → onboarding
 *    - Ready → main app
 *
 * No intermediate loading screen. Ever.
 */

function AppContent() {
  const [splashDone, setSplashDone] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  // Fire ALL queries immediately — they run during the splash
  const envQuery = useQuery(trpc.env.check.queryOptions());
  const activeQuery = useQuery(trpc.workspace.active.queryOptions());
  const workspacesQuery = useQuery(trpc.workspace.list.queryOptions());

  const dataReady = !envQuery.isLoading && !activeQuery.isLoading && !workspacesQuery.isLoading;

  const handleSplashComplete = useCallback(() => {
    setSplashDone(true);
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    setOnboardingComplete(true);
    queryClient.invalidateQueries({ queryKey: ["workspace"] });
  }, []);

  // Show splash until both the animation is done AND data is loaded
  if (!splashDone || !dataReady) {
    return <SplashScreen onComplete={handleSplashComplete} />;
  }

  // Route to the correct screen
  const phase = resolvePhase({
    envData: envQuery.data ?? null,
    activeWorkspace: activeQuery.data ?? null,
    workspaces: workspacesQuery.data ?? [],
    onboardingComplete,
  });

  switch (phase) {
    case "env-error": {
      const data = envQuery.data;
      return (
        <EnvCheck
          ghVersion={data?.ghVersion ?? null}
          gitVersion={data?.gitVersion ?? null}
          ghAuth={data?.ghAuth ?? false}
        />
      );
    }
    case "onboarding": {
      return <Onboarding onComplete={handleOnboardingComplete} />;
    }
    case "ready": {
      const cwd = activeQuery.data ?? workspacesQuery.data?.[0]?.path ?? "";
      return (
        <WorkspaceProvider cwd={cwd}>
          <AppLayout />
        </WorkspaceProvider>
      );
    }
  }
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

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider position="bottom-right">
        <AppContent />
      </ToastProvider>
    </QueryClientProvider>
  );
}
