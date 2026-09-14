import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { generateRoomCode } from "@/lib/room-code";
import { DEFAULT_BANNED_PAGES } from "@/lib/wiki";
import { withErrorHandling } from "@/lib/api-route";

export const POST = withErrorHandling(async (request: Request) => {
  const { name } = await request.json();
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const supabase = supabaseAdmin();

  let roomCode = "";
  for (let attempt = 0; attempt < 5 && !roomCode; attempt++) {
    const candidate = generateRoomCode();
    const { data } = await supabase.from("rooms").select("code").eq("code", candidate).maybeSingle();
    if (!data) roomCode = candidate;
  }
  if (!roomCode) {
    return NextResponse.json({ error: "Could not allocate a room code" }, { status: 500 });
  }

  const { error: roomError } = await supabase
    .from("rooms")
    .insert({ code: roomCode, banned_pages: DEFAULT_BANNED_PAGES });
  if (roomError) return NextResponse.json({ error: roomError.message }, { status: 500 });

  const playerId = randomUUID();
  const token = randomUUID();
  const { error: playerError } = await supabase.from("players").insert({
    id: playerId,
    room_code: roomCode,
    name: name.trim().slice(0, 30),
    is_host: true,
    token,
  });
  if (playerError) return NextResponse.json({ error: playerError.message }, { status: 500 });

  await supabase.from("rooms").update({ host_player_id: playerId }).eq("code", roomCode);

  return NextResponse.json({ roomCode, playerId, token });
});
