import { supabaseBrowser } from "@/lib/supabase/browser";
import type { Player, PlayerRow, RaceRow, RacePlayerRow, RoomRow } from "@/lib/types";

export function subscribeRoomRow(roomCode: string, onChange: (room: RoomRow) => void) {
  const supabase = supabaseBrowser();
  return supabase
    .channel(`room:${roomCode}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "rooms", filter: `code=eq.${roomCode}` },
      (payload) => onChange(payload.new as RoomRow)
    )
    .subscribe();
}

function playerFromRow(row: PlayerRow): Player {
  return { id: row.id, name: row.name, isHost: row.is_host, connected: row.connected };
}

// Shared by Lobby/Race/Finish — join, name, and is_host changes (the last
// from host-transfer) all need to reach every screen live.
export function subscribePlayersTable(roomCode: string, onChange: (player: Player) => void) {
  const supabase = supabaseBrowser();
  return supabase
    .channel(`players:${roomCode}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "players", filter: `room_code=eq.${roomCode}` },
      (payload) => onChange(playerFromRow(payload.new as PlayerRow))
    )
    .subscribe();
}

export function upsertPlayer(players: Player[], updated: Player): Player[] {
  const index = players.findIndex((p) => p.id === updated.id);
  if (index === -1) return [...players, updated];
  const copy = [...players];
  copy[index] = updated;
  return copy;
}

export function subscribeRace(
  raceId: string,
  onRaceChange: (race: RaceRow) => void,
  onRacePlayerChange: (racePlayer: RacePlayerRow) => void
) {
  const supabase = supabaseBrowser();
  return supabase
    .channel(`race:${raceId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "races", filter: `id=eq.${raceId}` },
      (payload) => onRaceChange(payload.new as RaceRow)
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "race_players", filter: `race_id=eq.${raceId}` },
      (payload) => onRacePlayerChange(payload.new as RacePlayerRow)
    )
    .subscribe();
}
