import { useEffect, useRef, useState } from "react";

/**
 * Splash screen — shows while the app initializes behind it.
 *
 * The parent fires all tRPC queries immediately. The splash runs
 * its animation for a minimum of 1.2s, then calls onComplete.
 * The parent holds the splash visible until data is also ready.
 *
 * Design: DISPATCH-DESIGN-SYSTEM.md § 10.5
 */

interface SplashScreenProps {
  onComplete: () => void;
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [phase, setPhase] = useState<"logo" | "text">("logo");
  const calledRef = useRef(false);

  useEffect(() => {
    // Phase 1 → Phase 2: text fades in after 300ms
    const textTimer = setTimeout(() => {
      setPhase("text");
    }, 300);

    // Signal readiness after minimum animation time (1.2s)
    const readyTimer = setTimeout(() => {
      if (!calledRef.current) {
        calledRef.current = true;
        onComplete();
      }
    }, 1200);

    return () => {
      clearTimeout(textTimer);
      clearTimeout(readyTimer);
    };
  }, [onComplete]);

  return (
    <div className="bg-bg-root fixed inset-0 z-50 flex flex-col items-center justify-center">
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

      {/* App name */}
      <div
        className={`mt-5 transition-all duration-500 ${
          phase === "text" ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        }`}
      >
        <span className="text-text-primary text-lg font-semibold tracking-[-0.02em]">Dispatch</span>
      </div>

      {/* Subtle loading bar */}
      <div
        className={`mt-6 transition-opacity duration-500 ${
          phase === "text" ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="bg-border h-[2px] w-12 overflow-hidden rounded-full">
          <div
            className="bg-primary/50 h-full animate-pulse rounded-full"
            style={{ width: "60%" }}
          />
        </div>
      </div>
    </div>
  );
}
