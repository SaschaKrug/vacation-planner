// Supabase Edge Function entry point: https://<project>.supabase.co/functions/v1/api
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHandler } from "../_shared/handler.ts";
import { addressHasher, clientAddress, SupabaseRateLimiter } from "../_shared/rate_limit.ts";
import { SupabaseStore } from "../_shared/supabase_store.ts";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");

const db = createClient(url, key, { auth: { persistSession: false } });

// Inside the function, request URLs don't carry the public host and path, so links in the
// AI instructions page are built from the project URL.
const publicBase = `${url.replace(/\/+$/, "")}/functions/v1/api`;

// The service role key is a secret the function already has: keying the hash with it means
// the stored counters can't be traced back to addresses.
const hashAddress = addressHasher(key);

Deno.serve(createHandler(new SupabaseStore(db), {
  publicBase,
  // Encrypts the families' AI keys; set with `supabase secrets set AI_CONFIG_KEY=...`.
  aiSecret: Deno.env.get("AI_CONFIG_KEY") || undefined,
  rateLimiter: new SupabaseRateLimiter(db),
  clientKey: (req) => hashAddress(clientAddress(req)),
  // The app's origin(s), comma-separated (the deploy sets it): only those may use passkeys.
  appOrigins: Deno.env.get("APP_ORIGIN")?.split(",").map((o) => o.trim()).filter(Boolean),
  // The first admin's password; "admin" if not set (it has to be changed at the first sign-in).
  initialAdminPassword: Deno.env.get("INITIAL_ADMIN_PASSWORD") || undefined,
}));
