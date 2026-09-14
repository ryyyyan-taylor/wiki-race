import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { authenticatePlayer } from "@/lib/auth";
import { pickRandomArticlePair } from "@/lib/wiki";
import { withErrorHandling } from "@/lib/api-route";

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const roomCode = code.toUpperCase();
  const { playerId, token } = await request.json();

  const supabase = supabaseAdmin();
  const player = await authenticatePlayer(supabase, roomCode, playerId, token);
  if (!player?.is_host) {
    return NextResponse.json({ error: "Only the host can start the race" }, { status: 403 });
  }

  const { data: room } = await supabase.from("rooms").select("*").eq("code", roomCode).single();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.status !== "lobby") {
    // Guards against a double-click or a second host tab firing this twice.
    return NextResponse.json({ error: "The race has already started" }, { status: 409 });
  }

  // The lobby keeps rooms.start_page/target_page populated with a random
  // pick (see /random-pages) the moment they're empty, so this is normally
  // already set by the time Start Race is clickable. Only a fresh fallback
  // for the rare case that auto-fill hasn't landed yet.
  let startPage: string | null = room.start_page;
  let targetPage: string | null = room.target_page;
  if (!startPage || !targetPage || startPage === targetPage) {
    const pair = await pickRandomArticlePair();
    startPage = pair.startPage;
    targetPage = pair.targetPage;
  }

  const { data: race, error: raceError } = await supabase
    .from("races")
    .insert({ room_code: roomCode, start_page: startPage, target_page: targetPage })
    .select()
    .single();
  if (raceError || !race) {
    return NextResponse.json({ error: raceError?.message ?? "Could not start race" }, { status: 500 });
  }

  const { data: players } = await supabase.from("players").select("id").eq("room_code", roomCode);

  // No visits row yet — the client's first navigate() call to startPage
  // records it, so there's exactly one insert per page ever seen.
  await supabase.from("race_players").insert(
    (players ?? []).map((p) => ({ race_id: race.id, player_id: p.id, current_page: startPage }))
  );

  await supabase
    .from("rooms")
    .update({ status: "racing", start_page: startPage, target_page: targetPage })
    .eq("code", roomCode);

  return NextResponse.json({ raceId: race.id, startPage, targetPage });
});
