import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { authenticatePlayer } from "@/lib/auth";
import { getLinkedPages } from "@/lib/wiki";
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

  const bannedPages = new Set(room?.banned_pages ?? []);
  const candidates = (await getLinkedPages(race.target_page)).filter(
    (title) => title !== race.start_page && title !== race.target_page && !bannedPages.has(title)
  );
  if (candidates.length === 0) {
    return NextResponse.json({ error: "Could not get a hint for this page" }, { status: 500 });
  }

  const alreadyRevealed: string[] = race.linked_page_hints ?? [];
  const nextCount = Math.min(alreadyRevealed.length + 1, candidates.length);
  const pages = candidates.slice(0, nextCount);
  const hasMore = nextCount < candidates.length;

  if (pages.length !== alreadyRevealed.length) {
    await supabase.from("races").update({ linked_page_hints: pages }).eq("id", race.id);
  }

  return NextResponse.json({ pages, hasMore });
});
