import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { authenticatePlayer } from "@/lib/auth";
import { collapseToShortestPath } from "@/lib/shortest-path";
import { fetchArticle, resolveCanonicalTitle } from "@/lib/wiki";
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

  // Nor do these two — the race_player row lookup and resolving the
  // clicked title against Wikipedia are unrelated.
  const [racePlayerResult, canonicalTitle] = await Promise.all([
    supabase.from("race_players").select("*").eq("race_id", race.id).eq("player_id", playerId).single(),
    resolveCanonicalTitle(title),
  ]);
  const racePlayer = racePlayerResult.data;

  if (!racePlayer || racePlayer.status !== "racing") {
    return NextResponse.json({ error: "You are not racing" }, { status: 409 });
  }
  if (!canonicalTitle) return NextResponse.json({ status: "not_found" });

  // A reload/resume of the page the player is already on: re-serve it
  // without recording a duplicate visit or re-checking banned pages.
  if (canonicalTitle === racePlayer.current_page) {
    const article = await fetchArticle(canonicalTitle);
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

  const article = await fetchArticle(canonicalTitle);

  const sequenceIndex = racePlayer.pages_visited_count;
  const pagesVisitedCount = racePlayer.pages_visited_count + 1;
  await Promise.all([
    supabase.from("visits").insert({
      race_id: race.id,
      player_id: playerId,
      page_title: article.title,
      sequence_index: sequenceIndex,
    }),
    supabase
      .from("race_players")
      .update({ pages_visited_count: pagesVisitedCount, current_page: article.title })
      .eq("race_id", race.id)
      .eq("player_id", playerId),
  ]);
  // No broadcast needed — that race_players update is itself what other
  // players' Postgres Changes subscriptions pick up as live progress.

  if (article.title !== race.target_page) {
    return NextResponse.json({
      status: "ok",
      title: article.title,
      html: article.html,
      tocHtml: article.tocHtml,
      detailsHtml: article.detailsHtml,
      pagesVisitedCount,
    });
  }

  const [{ data: visits }] = await Promise.all([
    supabase
      .from("visits")
      .select("page_title")
      .eq("race_id", race.id)
      .eq("player_id", playerId)
      .order("sequence_index", { ascending: true }),
    supabase
      .from("race_players")
      .update({ status: "finished", finished_at: new Date().toISOString() })
      .eq("race_id", race.id)
      .eq("player_id", playerId),
  ]);
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

  return NextResponse.json({
    status: "win",
    title: article.title,
    html: article.html,
    tocHtml: article.tocHtml,
    detailsHtml: article.detailsHtml,
    pagesVisitedCount,
  });
});
