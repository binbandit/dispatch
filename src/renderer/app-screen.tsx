import type { Workspace } from "@/shared/ipc";

import { EnvCheck } from "./components/setup/env-check";
import { Onboarding } from "./components/setup/onboarding";
import { AppLayout } from "./components/shell/app-layout";
import { initPostHog } from "./lib/app/posthog";
import { WorkspaceProvider } from "./lib/app/workspace-context";

type AppPhase = "env-error" | "onboarding" | "ready";

export interface AppEnvironmentStatus {
  ghVersion: string | null;
  gitVersion: string | null;
  ghAuth: boolean;
}

export interface ActiveWorkspaceSummary {
  id: number;
  owner: string;
  repo: string;
  path: string | null;
  name: string;
}

interface ResolveAppPhaseArgs {
  envData: AppEnvironmentStatus | null;
  activeWorkspace: ActiveWorkspaceSummary | null;
  workspaces: Workspace[];
  onboardingComplete: boolean;
}

interface AppScreenProps {
  activeWorkspace: ActiveWorkspaceSummary | null;
  envData: AppEnvironmentStatus | null;
  onboardingComplete: boolean;
  onOnboardingComplete: () => void;
  onRetryEnvCheck: () => void;
  workspaces: Workspace[];
}

export function resolveAppPhase({
  envData,
  activeWorkspace,
  workspaces,
  onboardingComplete,
}: ResolveAppPhaseArgs): AppPhase {
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

export function AppScreen({
  activeWorkspace,
  envData,
  onboardingComplete,
  onOnboardingComplete,
  onRetryEnvCheck,
  workspaces,
}: AppScreenProps) {
  const phase = resolveAppPhase({
    envData,
    activeWorkspace,
    workspaces,
    onboardingComplete,
  });

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
      const workspace = activeWorkspace ?? workspaces[0];
      if (!workspace) {
        return <Onboarding onComplete={onOnboardingComplete} />;
      }

      void initPostHog().catch(() => {});

      return (
        <WorkspaceProvider workspace={workspace}>
          <AppLayout />
        </WorkspaceProvider>
      );
    }
  }
}
