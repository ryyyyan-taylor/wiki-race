import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { authenticatePlayer } from "@/lib/auth";
import { getIntroSentences, splitSentences } from "@/lib/wiki";
import { withErrorHandling } from "@/lib/api-route";

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const roomCode = code.toUpperCase();
  const { playerId, token } = await request.json();

  const supabase = supabaseAdmin();
  const player = await authenticatePlayer(supabase, roomCode, playerId, token);
  if (!player?.is_host) {
    return NextResponse.json({ error: "Only the host can reveal a hint" }, { status: 403 });
  }

  const { data: race } = await supabase
    .from("races")
    .select("*")
    .eq("room_code", roomCode)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!race) return NextResponse.json({ error: "No active race" }, { status: 409 });

  const sentences = await getIntroSentences(race.target_page);
  if (sentences.length === 0) {
    return NextResponse.json({ error: "Could not get a hint for this page" }, { status: 500 });
  }

  // Each call reveals one more sentence than the last hint already shown,
  // up to however many the intro actually has.
  const alreadyRevealed = race.hint_text ? splitSentences(race.hint_text).length : 0;
  const nextCount = Math.min(alreadyRevealed + 1, sentences.length);
  const hint = sentences.slice(0, nextCount).join(" ");
  const hasMore = nextCount < sentences.length;

  if (hint !== race.hint_text) {
    await supabase
      .from("races")
      .update({ hint_text: hint, hint_revealed_at: new Date().toISOString() })
      .eq("id", race.id);
  }

  return NextResponse.json({ hint, hasMore });
});
