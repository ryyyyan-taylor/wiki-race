import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { authenticatePlayer } from "@/lib/auth";
import { withErrorHandling } from "@/lib/api-route";

// Called by a client that's elected itself the next host (see
// useHostFailover) because presence shows the current host gone. Trusts
// that client-side election — friend-scale trust model, not adversarial.
export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const roomCode = code.toUpperCase();
  const { playerId, token } = await request.json();

  const supabase = supabaseAdmin();
  const player = await authenticatePlayer(supabase, roomCode, playerId, token);
  if (!player) return NextResponse.json({ error: "Not authenticated" }, { status: 403 });
  if (player.is_host) return NextResponse.json({ ok: true });

  await Promise.all([
    supabase.from("players").update({ is_host: false }).eq("room_code", roomCode).eq("is_host", true),
    supabase.from("players").update({ is_host: true }).eq("id", playerId),
  ]);
  await supabase.from("rooms").update({ host_player_id: playerId }).eq("code", roomCode);

  return NextResponse.json({ ok: true });
});
