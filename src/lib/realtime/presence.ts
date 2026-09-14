import { useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { Identity } from "@/lib/identity";
import type { Player } from "@/lib/types";

export function subscribePresence(roomCode: string, playerId: string, onSync: (present: Set<string>) => void) {
  const supabase = supabaseBrowser();
  const channel = supabase.channel(`presence:${roomCode}`, {
    config: { presence: { key: playerId } },
  });
  channel
    .on("presence", { event: "sync" }, () => {
      onSync(new Set(Object.keys(channel.presenceState())));
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") channel.track({ playerId });
    });
  return channel;
}

// A brief presence drop (a page reload, an HMR reload in dev, a flaky
// connection reconnecting) makes the host disappear from `present` for a
// moment even though they never really left. Waiting this long before
// actually transferring host lets a reappearing host cancel it.
const FAILOVER_GRACE_MS = 8000;

// If presence shows the current host gone, the next-in-line present player
// (by original join order) claims host. Every client computes the same
// candidate from the same players list, so only that one client ever
// actually calls the transfer endpoint.
export function useHostFailover(roomCode: string, players: Player[], identity: Identity | null) {
  // `players` changes on every join/rename/transfer; reading it via a ref
  // instead of a dependency keeps the presence channel — and this client's
  // presence — alive across those, instead of flapping the subscription
  // (which would briefly drop this client from everyone else's presence
  // view and could trigger a spurious failover).
  const playersRef = useRef(players);
  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    if (!identity) return;
    let pendingTransfer: ReturnType<typeof setTimeout> | null = null;

    const channel = subscribePresence(roomCode, identity.playerId, (present) => {
      const currentPlayers = playersRef.current;
      const host = currentPlayers.find((p) => p.isHost);
      if (host && present.has(host.id)) {
        if (pendingTransfer) {
          clearTimeout(pendingTransfer);
          pendingTransfer = null;
        }
        return;
      }
      const nextHost = currentPlayers.find((p) => present.has(p.id) && !p.isHost);
      if (nextHost?.id !== identity.playerId || pendingTransfer) return;

      pendingTransfer = setTimeout(() => {
        pendingTransfer = null;
        fetch(`/api/rooms/${roomCode}/host-transfer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId: identity.playerId, token: identity.token }),
        });
      }, FAILOVER_GRACE_MS);
    });
    return () => {
      if (pendingTransfer) clearTimeout(pendingTransfer);
      channel.unsubscribe();
    };
  }, [roomCode, identity]);
}
