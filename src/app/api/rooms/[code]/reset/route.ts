import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { authenticatePlayer } from "@/lib/auth";
import { withErrorHandling } from "@/lib/api-route";

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const roomCode = code.toUpperCase();
  const { playerId, token } = await request.json();

  const supabase = supabaseAdmin();
  const player = await authenticatePlayer(supabase, roomCode, playerId, token);
  if (!player?.is_host) {
    return NextResponse.json({ error: "Only the host can return to the lobby" }, { status: 403 });
  }

  // Clears the per-race page picks so the next race defaults back to
  // random unless the host sets a manual override again; banned_pages is a
  // standing house rule and survives the reset.
  const { error } = await supabase
    .from("rooms")
    .update({ status: "lobby", start_page: null, target_page: null })
    .eq("code", roomCode);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
});
