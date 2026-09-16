"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getIdentity } from "@/lib/identity";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { subscribeRoomRow, subscribePlayersTable, subscribeRace, upsertPlayer } from "@/lib/realtime/tables";
import { useHostFailover } from "@/lib/realtime/presence";
import { displayTitle } from "@/lib/format";
import type { Player, RaceRow, RaceSnapshot, RoomRow } from "@/lib/types";

interface Props {
  roomCode: string;
}

function statusLabel(status: string, isWinner: boolean) {
  if (isWinner) return "Winner";
  if (status === "forfeited") return "Forfeited";
  return "Did not finish";
}

export function FinishView({ roomCode }: Props) {
  const router = useRouter();
  const [identity] = useState(() => getIdentity(roomCode));
  const [players, setPlayers] = useState<Player[]>([]);
  const [race, setRace] = useState<RaceSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isHost = useMemo(
    () => players.find((p) => p.id === identity?.playerId)?.isHost ?? false,
    [players, identity]
  );

  useEffect(() => {
    const id = identity;
    if (!id) {
      router.replace("/");
      return;
    }
    fetch(`/api/rooms/${roomCode}?playerId=${id.playerId}&token=${id.token}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.room) {
          setError("Room not found");
          return;
        }
        if (data.room.status === "lobby") {
          router.replace(`/lobby/${roomCode}`);
          return;
        }
        if (!data.race || data.race.status === "active") {
          router.replace(`/race/${roomCode}`);
          return;
        }
        setPlayers(data.players);
        setRace(data.race);
      });
  }, [roomCode, router, identity]);

  useEffect(() => {
    const channel = subscribeRoomRow(roomCode, (row: RoomRow) => {
      if (row.status === "lobby") router.push(`/lobby/${roomCode}`);
    });
    return () => {
      channel.unsubscribe();
    };
  }, [roomCode, router]);

  useEffect(() => {
    const channel = subscribePlayersTable(roomCode, (player) => {
      setPlayers((prev) => upsertPlayer(prev, player));
    });
    return () => {
      channel.unsubscribe();
    };
  }, [roomCode]);

  useHostFailover(roomCode, players, identity);

  const raceId = race?.id;
  useEffect(() => {
    if (!raceId) return;
    const applyOptimalPath = (row: RaceRow) => {
      if (row.id !== raceId) return;
      setRace((prev) => (prev ? { ...prev, optimalPath: row.optimal_path } : prev));
    };
    const channel = subscribeRace(raceId, applyOptimalPath, () => {});
    // Closes the gap between the initial fetch and the subscription actually
    // attaching: if the background search finished in that window, this
    // catches it instead of waiting on an update that already happened.
    supabaseBrowser()
      .from("races")
      .select("*")
      .eq("id", raceId)
      .single()
      .then(({ data }) => {
        if (data) applyOptimalPath(data as RaceRow);
      });
    return () => {
      channel.unsubscribe();
    };
  }, [raceId]);

  // The search itself gives up well before this, but a killed/crashed
  // background job (e.g. a serverless function's own time limit cutting off
  // the `after()` callback before it writes back) would otherwise leave the
  // finish page saying "Calculating…" forever — degrade to "not found"
  // instead once it's been too long.
  // Once `optimalPath` stops being null (found, empty, or the finish page
  // remounts for a new race) this timer is moot either way, so it only
  // needs to fire while it's still null — no need to reset the flag back.
  const [optimalPathTimedOut, setOptimalPathTimedOut] = useState(false);
  useEffect(() => {
    if (race?.optimalPath !== null) return;
    const timeout = setTimeout(() => setOptimalPathTimedOut(true), 20000);
    return () => clearTimeout(timeout);
  }, [race?.optimalPath]);

  const handleBackToLobby = useCallback(async () => {
    const id = identity;
    if (!id) return;
    setBusy(true);
    const res = await fetch(`/api/rooms/${roomCode}/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: id.playerId, token: id.token }),
    });
    setBusy(false);
    if (res.ok) router.push(`/lobby/${roomCode}`);
  }, [roomCode, router, identity]);

  if (error) {
    return <div className="flex flex-1 items-center justify-center">{error}</div>;
  }
  if (!race) {
    return <div className="flex flex-1 items-center justify-center">Loading…</div>;
  }

  const playerName = (id: string) => players.find((p) => p.id === id)?.name ?? "Player";

  return (
    <div className="flex flex-1 flex-col items-center p-6 gap-8">
      <div className="text-center">
        {race.winnerPlayerId ? (
          <>
            <h1 className="text-3xl font-bold">{playerName(race.winnerPlayerId)} won!</h1>
            <p className="text-zinc-500 mt-2 text-sm">Shortest path ({(race.winnerPath ?? []).length})</p>
            <p className="mt-1 font-mono text-sm max-w-lg">
              {(race.winnerPath ?? []).map(displayTitle).join(" → ")}
            </p>
          </>
        ) : (
          <h1 className="text-3xl font-bold">Everyone forfeited</h1>
        )}

        <div className="mt-4">
          <p className="text-zinc-500 text-sm">
            Best path found{(race.optimalPath ?? []).length > 0 ? ` (${race.optimalPath!.length})` : ""}
          </p>
          {race.optimalPath === null && !optimalPathTimedOut ? (
            <p className="mt-1 text-sm text-zinc-400 italic">Calculating…</p>
          ) : (race.optimalPath ?? []).length === 0 ? (
            <p className="mt-1 text-sm text-zinc-400 italic">No path found within search limits</p>
          ) : (
            <p className="mt-1 font-mono text-sm max-w-lg">{race.optimalPath!.map(displayTitle).join(" → ")}</p>
          )}
        </div>
      </div>

      <div className="w-full max-w-md">
        <h2 className="font-semibold mb-2">Results</h2>
        <ul className="divide-y rounded-lg border dark:border-zinc-700 dark:divide-zinc-700">
          {race.players
            .slice()
            .sort((a, b) => b.pagesVisitedCount - a.pagesVisitedCount)
            .map((rp) => (
              <li key={rp.playerId} className="px-4 py-2 text-sm">
                <details>
                  <summary className="flex justify-between cursor-pointer">
                    <span>{playerName(rp.playerId)}</span>
                    <span className="text-zinc-500">
                      {rp.pagesVisitedCount} pages — {statusLabel(rp.status, rp.playerId === race.winnerPlayerId)}
                    </span>
                  </summary>
                  <ol className="mt-2 ml-4 list-decimal space-y-0.5 font-mono text-xs text-zinc-500">
                    {rp.visitedPages.map((title, index) => (
                      <li key={index}>{displayTitle(title)}</li>
                    ))}
                  </ol>
                </details>
              </li>
            ))}
        </ul>
      </div>

      {isHost ? (
        <button
          onClick={handleBackToLobby}
          disabled={busy}
          className="rounded-full bg-black text-white px-8 py-3 font-medium disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Back to Lobby
        </button>
      ) : (
        <p className="text-zinc-500 text-sm">Waiting for the host to return everyone to the lobby…</p>
      )}
    </div>
  );
}
