import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { authenticatePlayer } from "@/lib/auth";
import { pickRandomArticleTitle } from "@/lib/wiki";
import { withErrorHandling } from "@/lib/api-route";

// Picks and persists a single field's random page server-side, so every
// viewer of the lobby converges on the same value via the `rooms` row
// subscription — nothing is ever guessed independently per client.
export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const roomCode = code.toUpperCase();
  const { playerId, token, field } = await request.json();
  if (field !== "start" && field !== "target") {
    return NextResponse.json({ error: "field must be 'start' or 'target'" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const player = await authenticatePlayer(supabase, roomCode, playerId, token);
  if (!player?.is_host) {
    return NextResponse.json({ error: "Only the host can do this" }, { status: 403 });
  }

  const { data: room } = await supabase.from("rooms").select("start_page, target_page").eq("code", roomCode).single();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const otherPage = field === "start" ? room.target_page : room.start_page;
  let title = await pickRandomArticleTitle();
  for (let attempts = 0; attempts < 5 && title === otherPage; attempts++) {
    title = await pickRandomArticleTitle();
  }

  const column = field === "start" ? "start_page" : "target_page";
  const { error } = await supabase.from("rooms").update({ [column]: title }).eq("code", roomCode);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ title });
});
