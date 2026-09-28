import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { authenticatePlayer } from "@/lib/auth";
import { resolveCanonicalTitle } from "@/lib/wiki";
import { withErrorHandling } from "@/lib/api-route";

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const roomCode = code.toUpperCase();
  const { playerId, token, startPage, targetPage, bannedPages, gameMode, boardSize } = await request.json();

  const supabase = supabaseAdmin();
  const player = await authenticatePlayer(supabase, roomCode, playerId, token);
  if (!player?.is_host) {
    return NextResponse.json({ error: "Only the host can change rules" }, { status: 403 });
  }

  const update: Record<string, unknown> = {};
  if (gameMode !== undefined) {
    if (!["race", "bingo", "double_bingo", "lockout"].includes(gameMode)) {
      return NextResponse.json({ error: "Invalid game mode" }, { status: 400 });
    }
    update.game_mode = gameMode;
  }
  if (boardSize !== undefined) {
    if (boardSize !== null && ![3, 4, 5].includes(boardSize)) {
      return NextResponse.json({ error: "Invalid board size" }, { status: 400 });
    }
    update.board_size = boardSize;
  }
  if (startPage !== undefined) {
    update.start_page = startPage ? await resolveCanonicalTitle(startPage) : null;
    if (startPage && !update.start_page) {
      return NextResponse.json({ error: `No Wikipedia page found for "${startPage}"` }, { status: 400 });
    }
  }
  if (targetPage !== undefined) {
    update.target_page = targetPage ? await resolveCanonicalTitle(targetPage) : null;
    if (targetPage && !update.target_page) {
      return NextResponse.json({ error: `No Wikipedia page found for "${targetPage}"` }, { status: 400 });
    }
  }
  if (bannedPages !== undefined) {
    const resolved = await Promise.all((bannedPages as string[]).map(resolveCanonicalTitle));
    update.banned_pages = resolved.filter((title): title is string => Boolean(title));
  }

  const { error } = await supabase.from("rooms").update(update).eq("code", roomCode);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
});
