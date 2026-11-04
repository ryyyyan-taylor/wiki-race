"use client";

import { useEffect, useRef, useState } from "react";

const HOLD_MS = 5000;

export function HoldBackButton({ onBack, disabled }: { onBack: () => void; disabled?: boolean }) {
  const [holding, setHolding] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setHolding(false);
  };

  const start = () => {
    if (disabled) return;
    setHolding(true);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setHolding(false);
      onBack();
    }, HOLD_MS);
  };

  useEffect(() => cancel, []);

  return (
    <button
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      disabled={disabled}
      title="Emergency only — hold for 5 seconds to return to your previous page"
      className="relative overflow-hidden rounded-full border px-3 py-1 text-sm select-none touch-none disabled:opacity-50 dark:border-zinc-600"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-red-500/40"
        style={{ width: holding ? "100%" : "0%", transition: holding ? `width ${HOLD_MS}ms linear` : "none" }}
      />
      <span className="relative">{holding ? "Keep holding…" : "← Back (hold)"}</span>
    </button>
  );
}
