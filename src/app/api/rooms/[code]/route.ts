import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { authenticatePlayer } from "@/lib/auth";
import { withErrorHandling } from "@/lib/api-route";
import type { RaceSnapshot } from "@/lib/types";

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const roomCode = code.toUpperCase();
  const supabase = supabaseAdmin();

  const [{ data: room }, { data: players }] = await Promise.all([
    supabase.from("rooms").select("*").eq("code", roomCode).maybeSingle(),
    supabase
      .from("players")
      .select("id, name, is_host, connected")
      .eq("room_code", roomCode)
      .order("created_at", { ascending: true }),
  ]);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  let race: RaceSnapshot | null = null;

  // Most recent race for the room, regardless of status — this is what's
  // "current": active while racing, or the just-finished one until the
  // host resets back to the lobby.
  const { data: latestRace } = await supabase
    .from("races")
    .select("*")
    .eq("room_code", roomCode)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestRace) {
    const racePlayersQuery = supabase
      .from("race_players")
      .select("player_id, status, pages_visited_count, current_page, remaining_path")
      .eq("race_id", latestRace.id);

    // Only needed once the race is over, for the finish page's per-player
    // visited-pages dropdown — skip it while still racing.
    const visitsQuery =
      latestRace.status === "active"
        ? null
        : supabase
            .from("visits")
            .select("player_id, page_title")
            .eq("race_id", latestRace.id)
            .order("sequence_index", { ascending: true });

    const [{ data: racePlayers }, visitsResult] = await Promise.all([racePlayersQuery, visitsQuery]);

    const visitedPagesByPlayer = new Map<string, string[]>();
    for (const visit of visitsResult?.data ?? []) {
      const pages = visitedPagesByPlayer.get(visit.player_id) ?? [];
      pages.push(visit.page_title);
      visitedPagesByPlayer.set(visit.player_id, pages);
    }

    let currentPage: string | null = null;
    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get("playerId");
    const token = searchParams.get("token");
    if (playerId && token) {
      const player = await authenticatePlayer(supabase, roomCode, playerId, token);
      if (player) {
        currentPage = racePlayers?.find((rp) => rp.player_id === playerId)?.current_page ?? null;
      }
    }

    race = {
      id: latestRace.id,
      status: latestRace.status,
      startPage: latestRace.start_page,
      targetPage: latestRace.target_page,
      startedAt: latestRace.started_at,
      hintText: latestRace.hint_text,
      linkedPageHints: latestRace.linked_page_hints ?? [],
      winnerPlayerId: latestRace.winner_player_id,
      winnerPath: latestRace.winner_path,
      players: (racePlayers ?? []).map((rp) => ({
        playerId: rp.player_id,
        status: rp.status,
        pagesVisitedCount: rp.pages_visited_count,
        visitedPages: visitedPagesByPlayer.get(rp.player_id) ?? [],
        remainingPath: rp.remaining_path,
      })),
      currentPage,
    };
  }

  return NextResponse.json({
    room: {
      code: room.code,
      status: room.status,
      startPage: room.start_page,
      targetPage: room.target_page,
      bannedPages: room.banned_pages,
    },
    players: (players ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.is_host,
      connected: p.connected,
    })),
    race,
  });
});
