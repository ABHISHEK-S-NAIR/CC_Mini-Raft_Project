import { useEffect, useRef } from "react";
import type { Point } from "../types";

type TextOverlayProps = {
  position: Point;
  fontSize: number;
  color: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
};

export function TextOverlay({ position, fontSize, color, onCommit, onCancel }: TextOverlayProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const value = ref.current?.value.trim();
      if (value) onCommit(value);
      else onCancel();
    }
    if (e.key === "Escape") {
      onCancel();
    }
  }

  function handleBlur() {
    const value = ref.current?.value.trim();
    if (value) onCommit(value);
    else onCancel();
  }

  return (
    <textarea
      ref={ref}
      className="board-text-overlay"
      style={{
        left: position.x,
        top: position.y,
        fontSize: `${fontSize}px`,
        color,
        lineHeight: `${fontSize * 1.2}px`,
      }}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      rows={1}
    />
  );
}
