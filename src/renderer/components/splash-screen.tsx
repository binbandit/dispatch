import { useEffect, useState } from "react";

/**
 * Splash screen shown while the app initializes.
 *
 * Matches DISPATCH-DESIGN-SYSTEM.md § 10.5 empty states:
 * - Instrument Serif italic for display text
 * - Warm copper accent colors
 * - Animated logo mark
 */

interface SplashScreenProps {
  onComplete: () => void;
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [phase, setPhase] = useState<"logo" | "text" | "done">("logo");

  useEffect(() => {
    // Phase 1: Logo appears (instant)
    // Phase 2: Text fades in (after 400ms)
    const textTimer = setTimeout(() => {
      setPhase("text");
    }, 400);

    // Phase 3: Transition to app (after 1200ms)
    const doneTimer = setTimeout(() => {
      setPhase("done");
    }, 1200);

    // Actually leave splash (after fade-out completes)
    const leaveTimer = setTimeout(() => {
      onComplete();
    }, 1600);

    return () => {
      clearTimeout(textTimer);
      clearTimeout(doneTimer);
      clearTimeout(leaveTimer);
    };
  }, [onComplete]);

  return (
    <div
      className={`bg-bg-root fixed inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-[400ms] ${
        phase === "done" ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* Logo mark — animated scale-in */}
      <div
        className={`bg-primary flex h-16 w-16 items-center justify-center rounded-lg transition-all duration-[600ms] ${
          phase === "logo" ? "scale-90 opacity-0" : "scale-100 opacity-100"
        }`}
        style={{
          boxShadow: "0 0 40px rgba(212, 136, 58, 0.15)",
          transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        <span className="font-heading text-bg-root text-4xl leading-none italic">d</span>
      </div>

      {/* App name — fades in after logo */}
      <div
        className={`mt-5 transition-all duration-500 ${
          phase === "text" || phase === "done"
            ? "translate-y-0 opacity-100"
            : "translate-y-2 opacity-0"
        }`}
      >
        <span className="text-text-primary text-lg font-semibold tracking-[-0.02em]">Dispatch</span>
      </div>

      {/* Subtitle */}
      <div
        className={`mt-2 transition-all delay-100 duration-500 ${
          phase === "text" || phase === "done"
            ? "translate-y-0 opacity-100"
            : "translate-y-2 opacity-0"
        }`}
      >
        <span className="text-text-tertiary text-xs">Code review, redefined.</span>
      </div>

      {/* Loading indicator */}
      <div
        className={`mt-8 transition-all delay-200 duration-500 ${
          phase === "text" || phase === "done" ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="bg-border h-[2px] w-16 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full"
            style={{
              animation: "splash-progress 1s ease-out forwards",
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes splash-progress {
          from { width: 0%; }
          to { width: 100%; }
        }
      `}</style>
    </div>
  );
}
