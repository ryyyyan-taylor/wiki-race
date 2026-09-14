"use client";

import { useSyncExternalStore } from "react";
import { getServerThemeSnapshot, getThemeSnapshot, subscribeTheme, toggleTheme } from "@/lib/theme";

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);

  return (
    <button
      onClick={toggleTheme}
      aria-label="Toggle dark mode"
      className="rounded-full border px-3 py-1 text-sm dark:border-zinc-600"
    >
      {dark ? "☀️ Light" : "🌙 Dark"}
    </button>
  );
}
