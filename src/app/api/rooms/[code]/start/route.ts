import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { authenticatePlayer } from "@/lib/auth";
import { pickRandomArticlePair, pickRandomArticleTitle } from "@/lib/wiki";
import { BINGO_PALETTE } from "@/lib/bingo";
import { withErrorHandling } from "@/lib/api-route";

// Draws board_size^2 distinct target-role pages (reusing the same
// topic-balanced picker classic mode uses for its target), disjoint from
// the start page and banned pages. Bounded rather than unbounded — a
// collision-heavy run degrades to a thrown error same as pickRandomArticle's
// own retry-5x convention, instead of hanging forever.
async function generateBoardPages(boardSize: number, exclude: Set<string>): Promise<string[]> {
  const needed = boardSize * boardSize;
  const seen = new Set(exclude);
  const pages: string[] = [];
  const maxAttempts = needed * 5;
  for (let attempt = 0; attempt < maxAttempts && pages.length < needed; attempt++) {
    const title = await pickRandomArticleTitle("target");
    if (seen.has(title)) continue;
    seen.add(title);
    pages.push(title);
  }
  if (pages.length < needed) throw new Error("Could not generate a full bingo board");
  return pages;
}

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

  let startPage: string | null = room.start_page;
  let targetPage: string | null = room.target_page;
  let boardPages: string[] | null = null;
  const boardSize = room.board_size ?? 4;

  if (room.game_mode === "race") {
    // The lobby keeps rooms.start_page/target_page populated with a random
    // pick (see /random-pages) the moment they're empty, so this is normally
    // already set by the time Start Race is clickable. Only a fresh fallback
    // for the rare case that auto-fill hasn't landed yet.
    if (!startPage || !targetPage || startPage === targetPage) {
      const pair = await pickRandomArticlePair();
      startPage = pair.startPage;
      targetPage = pair.targetPage;
    }
  } else {
    // Bingo-family: start page stays host-configurable like classic mode,
    // but the board itself is always random and only generated here — never
    // written to `rooms`, which is what keeps it hidden from the lobby.
    if (!startPage) startPage = await pickRandomArticleTitle("start");
    targetPage = null;
    boardPages = await generateBoardPages(boardSize, new Set([startPage, ...(room.banned_pages ?? [])]));
  }

  const { data: race, error: raceError } = await supabase
    .from("races")
    .insert({
      room_code: roomCode,
      start_page: startPage,
      target_page: targetPage,
      game_mode: room.game_mode,
      board_size: room.game_mode === "race" ? null : boardSize,
      board_pages: boardPages,
    })
    .select()
    .single();
  if (raceError || !race) {
    return NextResponse.json({ error: raceError?.message ?? "Could not start race" }, { status: 500 });
  }

  const { data: players } = await supabase
    .from("players")
    .select("id")
    .eq("room_code", roomCode)
    .order("created_at", { ascending: true });

  // No visits row yet — the client's first navigate() call to startPage
  // records it, so there's exactly one insert per page ever seen. Colors
  // are assigned by join order so they're stable and reproducible; unused
  // (null) outside bingo-family modes.
  await supabase.from("race_players").insert(
    (players ?? []).map((p, index) => ({
      race_id: race.id,
      player_id: p.id,
      current_page: startPage,
      color: room.game_mode === "race" ? null : BINGO_PALETTE[index % BINGO_PALETTE.length],
    }))
  );

  await supabase
    .from("rooms")
    .update({ status: "racing", start_page: startPage, target_page: targetPage })
    .eq("code", roomCode);

  return NextResponse.json({ raceId: race.id, startPage, targetPage, boardPages });
});
