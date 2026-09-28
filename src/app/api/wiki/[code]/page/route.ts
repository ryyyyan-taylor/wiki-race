import { NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { authenticatePlayer } from "@/lib/auth";
import { collapseToShortestPath } from "@/lib/shortest-path";
import { computeOptimalPath } from "@/lib/optimal-path";
import { fetchArticle } from "@/lib/wiki";
import { hasWon, leadingClaimant, type BingoGameMode } from "@/lib/bingo";
import { withErrorHandling } from "@/lib/api-route";

const UNIQUE_VIOLATION = "23505";

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const roomCode = code.toUpperCase();
  const { playerId, token, title } = await request.json();
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  const supabase = supabaseAdmin();

  // None of these three depend on each other's results.
  const [player, room, race] = await Promise.all([
    authenticatePlayer(supabase, roomCode, playerId, token),
    supabase
      .from("rooms")
      .select("*")
      .eq("code", roomCode)
      .single()
      .then((r) => r.data),
    supabase
      .from("races")
      .select("*")
      .eq("room_code", roomCode)
      .eq("status", "active")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then((r) => r.data),
  ]);

  if (!player) return NextResponse.json({ error: "Not authenticated" }, { status: 403 });
  if (!room || room.status !== "racing") {
    return NextResponse.json({ error: "No race in progress" }, { status: 409 });
  }
  if (!race) return NextResponse.json({ error: "No active race" }, { status: 409 });

  const [racePlayerResult, article] = await Promise.all([
    supabase.from("race_players").select("*").eq("race_id", race.id).eq("player_id", playerId).single(),
    // Resolves redirects and parses in one Wikipedia request instead of
    // two sequential ones — the biggest single latency win available here,
    // since this call (unlike the Supabase ones) can't run concurrently
    // with anything before it that depends on its result.
    fetchArticle(title),
  ]);
  const racePlayer = racePlayerResult.data;

  if (!racePlayer || racePlayer.status !== "racing") {
    return NextResponse.json({ error: "You are not racing" }, { status: 409 });
  }
  if (!article) return NextResponse.json({ status: "not_found" });
  const canonicalTitle = article.title;

  // A reload/resume of the page the player is already on: re-serve it
  // without recording a duplicate visit or re-checking banned pages (or,
  // in bingo-family modes, re-attempting a claim they'd have already made
  // the first time they landed here).
  if (canonicalTitle === racePlayer.current_page) {
    return NextResponse.json({
      status: "ok",
      title: article.title,
      html: article.html,
      tocHtml: article.tocHtml,
      detailsHtml: article.detailsHtml,
      pagesVisitedCount: racePlayer.pages_visited_count,
    });
  }

  if (room.banned_pages?.includes(canonicalTitle)) {
    return NextResponse.json({ status: "blocked", title: canonicalTitle });
  }

  const sequenceIndex = racePlayer.pages_visited_count;
  const pagesVisitedCount = sequenceIndex + 1;
  const visitInsert = supabase
    .from("visits")
    .insert({ race_id: race.id, player_id: playerId, page_title: canonicalTitle, sequence_index: sequenceIndex });

  // Who (if anyone) has just won, as of this navigation. In classic 'race'
  // mode this can only ever be the clicking player. In lockout, it can be a
  // *different* player: if this click happens to be the one that fills the
  // last unclaimed square with still nobody at majority, the race ends for
  // whoever holds the most squares — not necessarily this request's player.
  let winnerPlayerId: string | null = null;

  if (race.game_mode === "race") {
    if (canonicalTitle === race.target_page) winnerPlayerId = playerId;
  } else {
    const squareIndex = race.board_pages?.indexOf(canonicalTitle) ?? -1;
    if (squareIndex >= 0) {
      // Claiming needs the player's resulting claim set read back before the
      // win check below, so — unlike a plain non-winning navigation — this
      // can't go through the deferred after() path.
      const { error: claimError } = await supabase.from("bingo_claims").insert({
        race_id: race.id,
        player_id: playerId,
        square_index: squareIndex,
        page_title: canonicalTitle,
        exclusive: race.game_mode === "lockout",
      });
      // A unique-violation means either a harmless revisit-of-my-own-square
      // (idempotent, not an error) or someone else beat this player to an
      // exclusive lockout square (also not an error — the page just doesn't
      // get claimed for them). Anything else is a real failure.
      if (claimError && claimError.code !== UNIQUE_VIOLATION) throw new Error(claimError.message);

      const { data: myClaims } = await supabase
        .from("bingo_claims")
        .select("square_index")
        .eq("race_id", race.id)
        .eq("player_id", playerId);
      const claimedIndices = new Set((myClaims ?? []).map((c) => c.square_index));

      if (hasWon(race.game_mode as BingoGameMode, claimedIndices, race.board_size!)) {
        winnerPlayerId = playerId;
      } else if (race.game_mode === "lockout") {
        const { count: totalClaims } = await supabase
          .from("bingo_claims")
          .select("*", { count: "exact", head: true })
          .eq("race_id", race.id);
        if ((totalClaims ?? 0) >= race.board_size! * race.board_size!) {
          // Every square is claimed and nobody hit a majority — end the race
          // for whoever holds the most squares, tie-broken by whoever
          // reached that count first.
          const { data: allClaims } = await supabase
            .from("bingo_claims")
            .select("player_id")
            .eq("race_id", race.id)
            .order("claimed_at", { ascending: true });
          winnerPlayerId = leadingClaimant((allClaims ?? []).map((c) => c.player_id));
        }
      }
    }
  }

  const winnerIsSelf = winnerPlayerId === playerId;
  const selfUpdate = supabase
    .from("race_players")
    .update(
      winnerIsSelf
        ? {
            pages_visited_count: pagesVisitedCount,
            current_page: canonicalTitle,
            status: "finished",
            finished_at: new Date().toISOString(),
          }
        : { pages_visited_count: pagesVisitedCount, current_page: canonicalTitle }
    )
    .eq("race_id", race.id)
    .eq("player_id", playerId);

  if (!winnerPlayerId) {
    // Nothing in this response depends on these having landed yet — let
    // them finish after the response goes out instead of making the click
    // wait on a Supabase round-trip it doesn't need. `race_players`
    // updating is itself what other players' subscriptions pick up as
    // live progress, so no separate broadcast either way.
    after(async () => {
      await Promise.all([visitInsert, selfUpdate]);
    });
    return NextResponse.json({
      status: "ok",
      title: article.title,
      html: article.html,
      tocHtml: article.tocHtml,
      detailsHtml: article.detailsHtml,
      pagesVisitedCount,
    });
  }

  // Winning is the one case that does need this committed first — the
  // shortest-path query (classic mode) and the races-row update right after
  // both read state this writes.
  await Promise.all([visitInsert, selfUpdate]);
  if (!winnerIsSelf) {
    await supabase
      .from("race_players")
      .update({ status: "finished", finished_at: new Date().toISOString() })
      .eq("race_id", race.id)
      .eq("player_id", winnerPlayerId);
  }

  let winnerPath: string[] | null = null;
  if (race.game_mode === "race") {
    const { data: visits } = await supabase
      .from("visits")
      .select("page_title")
      .eq("race_id", race.id)
      .eq("player_id", winnerPlayerId)
      .order("sequence_index", { ascending: true });
    winnerPath = collapseToShortestPath((visits ?? []).map((v) => v.page_title));
  }

  // Guarded on still-active: two players (or, in lockout, two different
  // trigger paths) can both compute a winner from the same instant: only
  // the first update actually lands, the second affects zero rows and is
  // treated below as "someone else already won this race, not me."
  const { data: raceEndedByThisRequest } = await supabase
    .from("races")
    .update({ status: "finished", winner_player_id: winnerPlayerId, winner_path: winnerPath, ended_at: new Date().toISOString() })
    .eq("id", race.id)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  // Clients pick up the actual result via their `races` row subscription;
  // standings come from the race_players stream they've already been
  // accumulating.

  if (raceEndedByThisRequest && race.game_mode === "race") {
    // For everyone still racing (i.e. not already forfeited — those got
    // their distance computed when they forfeited), find how far they were
    // from the finish from their last page. These searches can take several
    // seconds — run them after the response goes out and let the finish
    // page pick up each result via its `race_players` row subscription as
    // it lands.
    after(async () => {
      const { data: stillRacing } = await supabase
        .from("race_players")
        .select("player_id, current_page")
        .eq("race_id", race.id)
        .eq("status", "racing");
      await Promise.all(
        (stillRacing ?? []).map(async (rp) => {
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

  return NextResponse.json({
    status: raceEndedByThisRequest && winnerIsSelf ? "win" : "ok",
    title: article.title,
    html: article.html,
    tocHtml: article.tocHtml,
    detailsHtml: article.detailsHtml,
    pagesVisitedCount,
  });
});
