"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getIdentity } from "@/lib/identity";
import { subscribeRoomRow, subscribePlayersTable, upsertPlayer } from "@/lib/realtime/tables";
import { useHostFailover } from "@/lib/realtime/presence";
import { displayTitle } from "@/lib/format";
import type { Player, RaceSnapshot, RoomRow } from "@/lib/types";

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
            <p className="text-zinc-500 mt-2 text-sm">Shortest path</p>
            <p className="mt-1 font-mono text-sm max-w-lg">
              {(race.winnerPath ?? []).map(displayTitle).join(" → ")}
            </p>
          </>
        ) : (
          <h1 className="text-3xl font-bold">Everyone forfeited</h1>
        )}
      </div>

      <div className="w-full max-w-md">
        <h2 className="font-semibold mb-2">Results</h2>
        <ul className="divide-y rounded-lg border dark:border-zinc-700 dark:divide-zinc-700">
          {race.players
            .slice()
            .sort((a, b) => b.pagesVisitedCount - a.pagesVisitedCount)
            .map((rp) => (
              <li key={rp.playerId} className="px-4 py-2 flex justify-between text-sm">
                <span>{playerName(rp.playerId)}</span>
                <span className="text-zinc-500">
                  {rp.pagesVisitedCount} pages — {statusLabel(rp.status, rp.playerId === race.winnerPlayerId)}
                </span>
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
