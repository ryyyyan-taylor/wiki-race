import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { authenticatePlayer } from "@/lib/auth";
import { pickRandomArticleTitle } from "@/lib/wiki";
import { VITAL_TOPICS, type VitalTopic } from "@/lib/vital-topics";
import { withErrorHandling } from "@/lib/api-route";

// Picks and persists a single field's random page server-side, so every
// viewer of the lobby converges on the same value via the `rooms` row
// subscription — nothing is ever guessed independently per client. `topic`
// is optional and, when given, pins the draw to that vital-article topic
// instead of drawing one uniformly at random.
export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const roomCode = code.toUpperCase();
  const { playerId, token, field, topic } = await request.json();
  if (field !== "start" && field !== "target") {
    return NextResponse.json({ error: "field must be 'start' or 'target'" }, { status: 400 });
  }
  if (topic !== undefined && !VITAL_TOPICS.includes(topic)) {
    return NextResponse.json({ error: "Invalid topic" }, { status: 400 });
  }
  const chosenTopic: VitalTopic | undefined = topic;

  const supabase = supabaseAdmin();
  const player = await authenticatePlayer(supabase, roomCode, playerId, token);
  if (!player?.is_host) {
    return NextResponse.json({ error: "Only the host can do this" }, { status: 403 });
  }

  const { data: room } = await supabase.from("rooms").select("start_page, target_page").eq("code", roomCode).single();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const otherPage = field === "start" ? room.target_page : room.start_page;
  let title = await pickRandomArticleTitle(field, chosenTopic);
  for (let attempts = 0; attempts < 5 && title === otherPage; attempts++) {
    title = await pickRandomArticleTitle(field, chosenTopic);
  }

  const column = field === "start" ? "start_page" : "target_page";
  const { error } = await supabase.from("rooms").update({ [column]: title }).eq("code", roomCode);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ title });
});
