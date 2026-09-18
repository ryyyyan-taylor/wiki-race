import { NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { authenticatePlayer } from "@/lib/auth";
import { collapseToShortestPath } from "@/lib/shortest-path";
import { computeOptimalPath } from "@/lib/optimal-path";
import { fetchArticle } from "@/lib/wiki";
import { withErrorHandling } from "@/lib/api-route";

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
  // without recording a duplicate visit or re-checking banned pages.
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
  const isWin = canonicalTitle === race.target_page;
  const visitInsert = supabase
    .from("visits")
    .insert({ race_id: race.id, player_id: playerId, page_title: canonicalTitle, sequence_index: sequenceIndex });

  if (!isWin) {
    // Nothing in this response depends on these having landed yet — let
    // them finish after the response goes out instead of making the click
    // wait on a Supabase round-trip it doesn't need. `race_players`
    // updating is itself what other players' subscriptions pick up as
    // live progress, so no separate broadcast either way.
    after(async () => {
      await Promise.all([
        visitInsert,
        supabase
          .from("race_players")
          .update({ pages_visited_count: pagesVisitedCount, current_page: canonicalTitle })
          .eq("race_id", race.id)
          .eq("player_id", playerId),
      ]);
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

  // Winning is the one case that does need this visit committed first —
  // the shortest-path query right after reads it back.
  await Promise.all([
    visitInsert,
    supabase
      .from("race_players")
      .update({
        pages_visited_count: pagesVisitedCount,
        current_page: canonicalTitle,
        status: "finished",
        finished_at: new Date().toISOString(),
      })
      .eq("race_id", race.id)
      .eq("player_id", playerId),
  ]);

  const { data: visits } = await supabase
    .from("visits")
    .select("page_title")
    .eq("race_id", race.id)
    .eq("player_id", playerId)
    .order("sequence_index", { ascending: true });
  const shortestPath = collapseToShortestPath((visits ?? []).map((v) => v.page_title));

  await supabase
    .from("races")
    .update({
      status: "finished",
      winner_player_id: playerId,
      winner_path: shortestPath,
      ended_at: new Date().toISOString(),
    })
    .eq("id", race.id);
  // Clients pick this up via their `races` row subscription; standings
  // come from the race_players stream they've already been accumulating.

  // For everyone still racing (i.e. not already forfeited — those got their
  // distance computed when they forfeited), find how far they were from the
  // finish from their last page. These searches can take several seconds —
  // run them after the response goes out and let the finish page pick up
  // each result via its `race_players` row subscription as it lands.
  after(async () => {
    const { data: stillRacing } = await supabase
      .from("race_players")
      .select("player_id, current_page")
      .eq("race_id", race.id)
      .eq("status", "racing");
    await Promise.all(
      (stillRacing ?? []).map(async (rp) => {
        const remainingPath = await computeOptimalPath(rp.current_page, race.target_page);
        await supabase
          .from("race_players")
          .update({ remaining_path: remainingPath ?? [] })
          .eq("race_id", race.id)
          .eq("player_id", rp.player_id);
      })
    );
  });

  return NextResponse.json({
    status: "win",
    title: article.title,
    html: article.html,
    tocHtml: article.tocHtml,
    detailsHtml: article.detailsHtml,
    pagesVisitedCount,
  });
});
