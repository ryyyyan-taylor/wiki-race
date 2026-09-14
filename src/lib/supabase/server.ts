import { createClient } from "@supabase/supabase-js";

// Server-only client using the service-role key. Every table write/read
// goes through this — never import it from a client component.
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
