import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { generateRoomCode } from "@/lib/room-code";
import { DEFAULT_BANNED_PAGES } from "@/lib/wiki";
import { withErrorHandling } from "@/lib/api-route";

// A room only shows up as "open" once at least one of its players has
// heartbeated within this window (see the interval in LobbyView) — wide
// enough to absorb a missed beat or two, tight enough that a room nobody's
// actually in disappears from the list quickly.
const ROOM_STALE_MS = 45_000;

export const GET = withErrorHandling(async () => {
  const supabase = supabaseAdmin();
  const { data: rooms } = await supabase
    .from("rooms")
    .select("code, created_at")
    .eq("status", "lobby")
    .order("created_at", { ascending: false });
  if (!rooms || rooms.length === 0) return NextResponse.json({ rooms: [] });

  const { data: players } = await supabase
    .from("players")
    .select("room_code, name, is_host, last_seen_at")
    .in("room_code", rooms.map((r) => r.code));

  const byRoom = new Map<string, { hostName: string | null; playerCount: number }>();
  const staleBefore = Date.now() - ROOM_STALE_MS;
  for (const p of players ?? []) {
    const entry = byRoom.get(p.room_code) ?? { hostName: null, playerCount: 0 };
    if (p.is_host) entry.hostName = p.name;
    if (new Date(p.last_seen_at).getTime() >= staleBefore) entry.playerCount += 1;
    byRoom.set(p.room_code, entry);
  }

  const openRooms: { code: string; hostName: string; playerCount: number }[] = [];
  for (const room of rooms) {
    const entry = byRoom.get(room.code);
    if (entry?.hostName && entry.playerCount > 0) {
      openRooms.push({ code: room.code, hostName: entry.hostName, playerCount: entry.playerCount });
    }
  }

  return NextResponse.json({ rooms: openRooms });
});

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
