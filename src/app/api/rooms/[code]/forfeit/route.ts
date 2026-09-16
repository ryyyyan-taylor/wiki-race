import { NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { authenticatePlayer } from "@/lib/auth";
import { computeOptimalPath } from "@/lib/optimal-path";
import { withErrorHandling } from "@/lib/api-route";

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const roomCode = code.toUpperCase();
  const { playerId, token } = await request.json();

  const supabase = supabaseAdmin();
  const player = await authenticatePlayer(supabase, roomCode, playerId, token);
  if (!player) return NextResponse.json({ error: "Not authenticated" }, { status: 403 });

  const { data: race } = await supabase
    .from("races")
    .select("id, start_page, target_page")
    .eq("room_code", roomCode)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!race) return NextResponse.json({ error: "No active race" }, { status: 409 });

  const { data: racePlayer } = await supabase
    .from("race_players")
    .select("status")
    .eq("race_id", race.id)
    .eq("player_id", playerId)
    .single();
  if (!racePlayer || racePlayer.status !== "racing") {
    return NextResponse.json({ error: "You are not racing" }, { status: 409 });
  }

  await supabase
    .from("race_players")
    .update({ status: "forfeited", finished_at: new Date().toISOString() })
    .eq("race_id", race.id)
    .eq("player_id", playerId);

  const { data: allRacePlayers } = await supabase.from("race_players").select("status").eq("race_id", race.id);
  const allForfeited = (allRacePlayers ?? []).every((rp) => rp.status === "forfeited");
  if (allForfeited) {
    await supabase
      .from("races")
      .update({ status: "all_forfeited", ended_at: new Date().toISOString() })
      .eq("id", race.id);

    after(async () => {
      const optimalPath = await computeOptimalPath(race.start_page, race.target_page);
      await supabase
        .from("races")
        .update({ optimal_path: optimalPath ?? [] })
        .eq("id", race.id);
    });
  }

  return NextResponse.json({ ok: true });
});
