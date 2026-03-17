import { Spinner } from "@/components/ui/spinner";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { AppLayout } from "./components/app-layout";
import { EnvCheck } from "./components/env-check";
import { Onboarding } from "./components/onboarding";
import { SplashScreen } from "./components/splash-screen";
import { queryClient, trpc } from "./lib/trpc";
import { WorkspaceProvider } from "./lib/workspace-context";

/**
 * App boot sequence:
 *
 * 1. Splash screen (animated logo, 1.6s)
 * 2. Environment check (gh/git installed + authenticated?)
 * 3. Workspace check (has at least one repo configured?)
 * 4. Main app with active workspace context
 */

type AppPhase = "splash" | "loading" | "env-error" | "onboarding" | "ready";

function AppContent() {
  const [splashDone, setSplashDone] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  const handleSplashComplete = useCallback(() => {
    setSplashDone(true);
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    setOnboardingComplete(true);
    queryClient.invalidateQueries({ queryKey: ["workspace"] });
  }, []);

  if (!splashDone) {
    return <SplashScreen onComplete={handleSplashComplete} />;
  }

  return (
    <PostSplashApp
      onboardingComplete={onboardingComplete}
      onOnboardingComplete={handleOnboardingComplete}
    />
  );
}

function PostSplashApp({
  onboardingComplete,
  onOnboardingComplete,
}: {
  onboardingComplete: boolean;
  onOnboardingComplete: () => void;
}) {
  const envQuery = useQuery(trpc.env.check.queryOptions());
  const activeQuery = useQuery(trpc.workspace.active.queryOptions());
  const workspacesQuery = useQuery(trpc.workspace.list.queryOptions());

  const phase = resolvePhase({
    envLoading: envQuery.isLoading,
    envData: envQuery.data ?? null,
    activeWorkspace: activeQuery.data ?? null,
    workspaces: workspacesQuery.data ?? [],
    workspacesLoading: activeQuery.isLoading || workspacesQuery.isLoading,
    onboardingComplete,
  });

  switch (phase) {
    case "loading": {
      return (
        <div className="bg-bg-root flex h-screen items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Spinner className="text-primary h-5 w-5" />
            <span className="text-text-tertiary text-xs">Loading...</span>
          </div>
        </div>
      );
    }
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
      return <Onboarding onComplete={onOnboardingComplete} />;
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

function resolvePhase({
  envLoading,
  envData,
  activeWorkspace,
  workspaces,
  workspacesLoading,
  onboardingComplete,
}: {
  envLoading: boolean;
  envData: { ghVersion: string | null; gitVersion: string | null; ghAuth: boolean } | null;
  activeWorkspace: string | null;
  workspaces: Array<{ path: string }>;
  workspacesLoading: boolean;
  onboardingComplete: boolean;
}): AppPhase {
  if (envLoading) {
    return "loading";
  }

  if (envData && (!envData.ghVersion || !envData.gitVersion || !envData.ghAuth)) {
    return "env-error";
  }

  if (workspacesLoading) {
    return "loading";
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
      <AppContent />
    </QueryClientProvider>
  );
}
