// Supabase Edge Function entry point: https://<project>.supabase.co/functions/v1/api
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHandler } from "../_shared/handler.ts";
import { SupabaseStore } from "../_shared/supabase_store.ts";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");

const db = createClient(url, key, { auth: { persistSession: false } });

Deno.serve(createHandler(new SupabaseStore(db)));
