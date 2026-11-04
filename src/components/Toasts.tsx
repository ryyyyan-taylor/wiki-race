"use client";

import { useCallback, useState } from "react";

const TOAST_MS = 4000;

export interface Toast {
  id: number;
  text: string;
  color?: string | null;
}

let nextToastId = 0;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((text: string, color?: string | null) => {
    const id = nextToastId++;
    setToasts((prev) => [...prev, { id, text, color }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), TOAST_MS);
  }, []);

  return { toasts, showToast };
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed left-1/2 top-24 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex items-center gap-2 rounded border bg-white px-3 py-2 text-sm shadow-lg dark:border-zinc-600 dark:bg-zinc-900"
        >
          {toast.color && <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: toast.color }} />}
          {toast.text}
        </div>
      ))}
    </div>
  );
}
