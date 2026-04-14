import { DispatchLogo } from "@/renderer/components/shared/dispatch-logo";
import { useEffect, useRef, useState } from "react";

/**
 * Splash screen — always mounted, controls its own visibility.
 *
 * - `visible=true`: shows the splash with animation
 * - `visible=false`: fades out over 400ms, then pointer-events: none
 * - Calls `onComplete` once after minimum animation time (1.2s)
 * - Never unmounts/remounts — prevents the flash loop
 */

interface SplashScreenProps {
  onComplete: () => void;
  visible: boolean;
}

export function SplashScreen({ onComplete, visible }: SplashScreenProps) {
  const [showText, setShowText] = useState(false);
  const calledRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const textTimer = setTimeout(() => {
      setShowText(true);
    }, 300);

    const readyTimer = setTimeout(() => {
      if (!calledRef.current) {
        calledRef.current = true;
        onCompleteRef.current();
      }
    }, 1200);

    return () => {
      clearTimeout(textTimer);
      clearTimeout(readyTimer);
    };
  }, []);

  return (
    <div
      className="bg-bg-root fixed inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-[400ms]"
      style={{
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      {/* Logo mark */}
      <div
        className={`transition-[transform,opacity] duration-[600ms] ${
          showText ? "scale-100 opacity-100" : "scale-90 opacity-0"
        }`}
        style={{
          filter: "drop-shadow(0 0 40px rgba(212, 136, 58, 0.15))",
          transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        <DispatchLogo size={64} />
      </div>

      {/* App name */}
      <div
        className={`mt-5 transition-[transform,opacity] duration-500 ${
          showText ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        }`}
      >
        <span className="text-text-primary text-lg font-semibold tracking-[-0.02em]">Dispatch</span>
      </div>

      {/* Loading bar */}
      <div
        className={`mt-6 transition-opacity duration-500 ${showText ? "opacity-100" : "opacity-0"}`}
      >
        <div className="bg-border h-[2px] w-12 overflow-hidden rounded-full">
          <div
            className="bg-primary/50 h-full rounded-full"
            style={{
              animation: "splash-pulse 1.5s ease-in-out infinite",
              width: "60%",
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes splash-pulse {
          0%, 100% { transform: translateX(-20%); opacity: 0.4; }
          50% { transform: translateX(40%); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
