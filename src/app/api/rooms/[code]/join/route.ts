import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/api-route";

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  const roomCode = code.toUpperCase();
  const { name } = await request.json();
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const { data: room } = await supabase.from("rooms").select("code, status").eq("code", roomCode).maybeSingle();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.status !== "lobby") {
    return NextResponse.json({ error: "This room's race has already started" }, { status: 409 });
  }

  const playerId = randomUUID();
  const token = randomUUID();
  const trimmedName = name.trim().slice(0, 30);
  const { error } = await supabase.from("players").insert({
    id: playerId,
    room_code: roomCode,
    name: trimmedName,
    token,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ playerId, token });
});
