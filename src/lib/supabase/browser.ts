import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Client-side, anon-key client. Reads (rooms/players/races/race_players are
// public-read for Realtime to work with no per-player auth) and Realtime
// subscriptions go through this; all writes go through the Next.js API
// routes instead, using the service-role key server-side.
//
// Memoized — several independent subscribe calls each ask for one of these
// per mount, and supabase-js spins up its own auth client per instance, so
// without this they pile up and warn about duplicate GoTrueClients sharing
// the same localStorage key.
let client: SupabaseClient | undefined;

export function supabaseBrowser() {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return client;
}
