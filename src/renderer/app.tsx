import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { AppScreen } from "./app-screen";
import { SplashScreen } from "./components/shell/splash-screen";
import { ipc } from "./lib/app/ipc";
import { queryClient } from "./lib/app/query-client";

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
          envData={envQuery.data ?? null}
          activeWorkspace={activeQuery.data ?? null}
          workspaces={workspacesQuery.data ?? []}
          onboardingComplete={onboardingComplete}
          onOnboardingComplete={handleOnboardingComplete}
          onRetryEnvCheck={handleRetryEnvCheck}
        />
      )}
    </>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ToastProvider position="bottom-right">
          <AppContent />
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
