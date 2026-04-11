import { ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useRef, useState } from "react";

/**
 * CollapsibleDescription — caps long content at a threshold height,
 * shows a gradient fade, and provides a "Show more / Show less" toggle.
 *
 * Uses a ref callback to measure scrollHeight on mount (no useEffect).
 */

const COLLAPSE_HEIGHT = 150;

interface CollapsibleDescriptionProps {
  children: React.ReactNode;
  /** Max collapsed height in pixels. Defaults to 150. */
  maxHeight?: number;
}

export function CollapsibleDescription({
  children,
  maxHeight = COLLAPSE_HEIGHT,
}: CollapsibleDescriptionProps) {
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const measuredRef = useRef(false);

  const measureRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || measuredRef.current) {
        return;
      }
      measuredRef.current = true;
      if (node.scrollHeight > maxHeight + 20) {
        setIsOverflowing(true);
      }
    },
    [maxHeight],
  );

  if (!isOverflowing) {
    return <div ref={measureRef}>{children}</div>;
  }

  return (
    <div>
      <div
        ref={measureRef}
        style={{
          maxHeight: expanded ? "none" : `${maxHeight}px`,
          overflow: "hidden",
          position: "relative",
          transition: "max-height 300ms ease-in-out",
        }}
      >
        {children}
        {!expanded && (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: "48px",
              background: "linear-gradient(to bottom, transparent, var(--bg-raised))",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="text-accent-text hover:text-accent-hover mt-1 flex w-full cursor-pointer items-center justify-center gap-1 rounded-md py-1 text-[10px] font-medium transition-colors hover:bg-[rgba(212,136,58,0.06)]"
      >
        {expanded ? (
          <>
            Show less <ChevronUp size={10} />
          </>
        ) : (
          <>
            Show more <ChevronDown size={10} />
          </>
        )}
      </button>
    </div>
  );
}
