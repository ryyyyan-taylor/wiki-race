import { useSyncExternalStore } from "react";

export interface Identity {
  playerId: string;
  token: string;
  name: string;
}

const storageKey = (roomCode: string) => `wikirace:${roomCode.toUpperCase()}`;

// Cached so useIdentity's getSnapshot returns a stable reference when the
// underlying sessionStorage value hasn't changed (required by
// useSyncExternalStore to avoid re-render loops).
let cache: { roomCode: string; raw: string | null; identity: Identity | null } | null = null;

// sessionStorage, not localStorage: identity must not be shared across tabs
// of the same browser profile. Two tabs pointed at the same room used to
// silently collide on one `localStorage` key — each tab's next read of the
// (now cross-overwritten) key handed it whichever identity the other tab
// had just written, so both tabs ended up "being" the same player. Each
// tab gets its own sessionStorage even for the same origin, so this makes
// a tab the actual unit of identity, matching one player per tab/window.
export function getIdentity(roomCode: string): Identity | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(storageKey(roomCode));
  if (cache && cache.roomCode === roomCode && cache.raw === raw) return cache.identity;
  const identity = raw ? (JSON.parse(raw) as Identity) : null;
  cache = { roomCode, raw, identity };
  return identity;
}

const listeners = new Set<() => void>();

export function subscribeIdentity(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function setIdentity(roomCode: string, identity: Identity) {
  window.sessionStorage.setItem(storageKey(roomCode), JSON.stringify(identity));
  listeners.forEach((l) => l());
}

export function useIdentity(roomCode: string): Identity | null {
  return useSyncExternalStore(subscribeIdentity, () => getIdentity(roomCode), () => null);
}

export function getSavedName(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("wikirace:name") ?? "";
}

export function saveName(name: string) {
  window.localStorage.setItem("wikirace:name", name);
}
