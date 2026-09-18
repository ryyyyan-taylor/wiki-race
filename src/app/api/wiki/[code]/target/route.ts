import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { fetchArticle, getLinkedPages } from "@/lib/wiki";
import { withErrorHandling } from "@/lib/api-route";

// Read-only and post-race: the finish page's target-page preview and its
// full "pages that linked here" list, keyed off the room's most recent
// race rather than a client-supplied title.
export const GET = withErrorHandling(async (_request: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const roomCode = code.toUpperCase();
  const supabase = supabaseAdmin();

  const { data: race } = await supabase
    .from("races")
    .select("target_page")
    .eq("room_code", roomCode)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!race) return NextResponse.json({ error: "No race found" }, { status: 404 });

  const [article, linkedPages] = await Promise.all([
    fetchArticle(race.target_page),
    getLinkedPages(race.target_page),
  ]);
  if (!article) return NextResponse.json({ error: "Target page not found" }, { status: 404 });

  return NextResponse.json({ ...article, linkedPages });
});
