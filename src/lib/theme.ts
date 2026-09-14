export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("wikirace:theme");
    var dark = stored ? stored === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();
`;

const listeners = new Set<() => void>();

export function subscribeTheme(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getThemeSnapshot(): boolean {
  return document.documentElement.classList.contains("dark");
}

export function getServerThemeSnapshot(): boolean {
  return false;
}

export function toggleTheme(): void {
  const dark = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("wikirace:theme", dark ? "dark" : "light");
  } catch {}
  listeners.forEach((l) => l());
}
