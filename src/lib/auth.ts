import type { SupabaseClient } from "@supabase/supabase-js";

export async function authenticatePlayer(
  supabase: SupabaseClient,
  roomCode: string,
  playerId: string,
  token: string
) {
  const { data } = await supabase
    .from("players")
    .select("*")
    .eq("id", playerId)
    .eq("room_code", roomCode)
    .eq("token", token)
    .maybeSingle();
  return data;
}
