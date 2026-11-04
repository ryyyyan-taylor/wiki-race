import { NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { authenticatePlayer } from "@/lib/auth";
import { computeOptimalPath } from "@/lib/optimal-path";
import { withErrorHandling } from "@/lib/api-route";

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const roomCode = code.toUpperCase();
  const { playerId, token, vote } = await request.json();

  const supabase = supabaseAdmin();
  const player = await authenticatePlayer(supabase, roomCode, playerId, token);
  if (!player) return NextResponse.json({ error: "Not authenticated" }, { status: 403 });

  const { data: race } = await supabase
    .from("races")
    .select("id, target_page, game_mode")
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
    .update({ forfeit_vote: Boolean(vote) })
    .eq("race_id", race.id)
    .eq("player_id", playerId);

  // Each voter writes before reading, so whichever vote lands last always
  // sees the full set — and the still-active guard keeps two simultaneous
  // final votes from both ending the race.
  const { data: racing } = await supabase
    .from("race_players")
    .select("player_id, current_page, forfeit_vote")
    .eq("race_id", race.id)
    .eq("status", "racing");
  if (!racing?.length || !racing.every((rp) => rp.forfeit_vote)) return NextResponse.json({ ok: true });

  const { data: raceEndedByThisRequest } = await supabase
    .from("races")
    .update({ status: "all_forfeited", ended_at: new Date().toISOString() })
    .eq("id", race.id)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (!raceEndedByThisRequest) return NextResponse.json({ ok: true });

  await supabase
    .from("race_players")
    .update({ status: "forfeited", finished_at: new Date().toISOString() })
    .eq("race_id", race.id)
    .eq("status", "racing");

  // How far each player was from the finish, from where they gave up. Can
  // take a few seconds — run it after the response goes out and let the
  // finish page pick up the results via its `race_players` row subscription.
  // No single target in bingo-family modes, so there's no distance to compute.
  if (race.game_mode === "race") {
    after(async () => {
      await Promise.all(
        racing.map(async (rp) => {
          const remainingPath = await computeOptimalPath(rp.current_page, race.target_page!);
          await supabase
            .from("race_players")
            .update({ remaining_path: remainingPath ?? [] })
            .eq("race_id", race.id)
            .eq("player_id", rp.player_id);
        })
      );
    });
  }

  return NextResponse.json({ ok: true });
});
