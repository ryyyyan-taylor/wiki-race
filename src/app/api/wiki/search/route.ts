import { NextResponse } from "next/server";
import { searchArticleTitles } from "@/lib/wiki";
import { withErrorHandling } from "@/lib/api-route";

// Unauthenticated and room-agnostic: this only echoes back public Wikipedia
// article titles for the lobby's search-as-you-type inputs, nothing
// room- or player-specific to check.
export const GET = withErrorHandling(async (request: Request) => {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const titles = await searchArticleTitles(query);
  return NextResponse.json({ titles });
});
