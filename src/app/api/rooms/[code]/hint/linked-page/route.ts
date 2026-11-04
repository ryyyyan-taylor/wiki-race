import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { authenticatePlayer } from "@/lib/auth";
import { nextLinkedPages, resolveHintPage } from "@/lib/hints";
import type { BingoHints } from "@/lib/types";
import { withErrorHandling } from "@/lib/api-route";

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const roomCode = code.toUpperCase();
  const { playerId, token, squareIndex } = await request.json();

  const supabase = supabaseAdmin();
  const player = await authenticatePlayer(supabase, roomCode, playerId, token);
  if (!player?.is_host) {
    return NextResponse.json({ error: "Only the host can reveal a hint" }, { status: 403 });
  }

  const [{ data: race }, { data: room }] = await Promise.all([
    supabase
      .from("races")
      .select("*")
      .eq("room_code", roomCode)
      .eq("status", "active")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("rooms").select("banned_pages").eq("code", roomCode).maybeSingle(),
  ]);
  if (!race) return NextResponse.json({ error: "No active race" }, { status: 409 });

  const hintPage = resolveHintPage(race, squareIndex);
  if (!hintPage) return NextResponse.json({ error: "Invalid board square" }, { status: 400 });

  const bingoHints: BingoHints = race.bingo_hints ?? {};
  const squareKey = String(squareIndex);
  const alreadyRevealed: string[] =
    race.game_mode === "race" ? race.linked_page_hints ?? [] : bingoHints[squareKey]?.linkedPages ?? [];

  const result = await nextLinkedPages(
    hintPage,
    alreadyRevealed,
    new Set([race.start_page, ...(room?.banned_pages ?? [])])
  );
  if (!result) {
    return NextResponse.json({ error: "Could not get a hint for this page" }, { status: 500 });
  }

  if (result.pages.length !== alreadyRevealed.length) {
    const update =
      race.game_mode === "race"
        ? { linked_page_hints: result.pages }
        : {
            bingo_hints: {
              ...bingoHints,
              [squareKey]: { ...(bingoHints[squareKey] ?? { text: null }), linkedPages: result.pages },
            },
          };
    await supabase.from("races").update(update).eq("id", race.id);
  }

  return NextResponse.json(result);
});
