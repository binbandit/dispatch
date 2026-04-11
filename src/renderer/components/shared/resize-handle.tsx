import { useCallback, useRef, useState } from "react";

/**
 * Vertical resize handle — drag to resize adjacent panels.
 *
 * - Wide invisible hit area (11px) with a thin visible line (2px)
 * - Disables text selection during drag
 * - Changes cursor to col-resize
 * - Double-click to reset via onDoubleClick callback
 * - Calls onResize(clientX) continuously during drag
 */

interface ResizeHandleProps {
  onResize: (clientX: number) => void;
  onDoubleClick?: () => void;
}

export function ResizeHandle({ onResize, onDoubleClick }: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      onResizeRef.current(moveEvent.clientX);
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
  }, []);

  const visible = isDragging || isHovered;

  return (
    <div
      onPointerDown={handlePointerDown}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        width: "11px",
        marginLeft: "-5px",
        marginRight: "-6px",
        cursor: "col-resize",
        position: "relative",
        zIndex: 5,
        flexShrink: 0,
      }}
    >
      {/* Visible line */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: "5px",
          width: "1px",
          background: visible ? "var(--accent)" : "var(--border)",
          transition: isDragging ? "none" : "background 150ms ease",
        }}
      />
    </div>
  );
}
