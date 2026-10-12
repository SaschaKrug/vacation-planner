// Fixed-window request counters, so the API can limit how fast one client creates planners
// and writes. Edge Function instances come and go and don't share memory, so production
// counts in Postgres; tests and the dev server count in memory.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface RateLimiter {
  /** Counts a hit for `key` in the current window of `seconds` and returns the window's
   *  count so far, including this hit. */
  hit(key: string, seconds: number): Promise<number>;
}

export class MemoryRateLimiter implements RateLimiter {
  private windows = new Map<string, { start: number; hits: number }>();

  constructor(private now = () => Date.now()) {}

  hit(key: string, seconds: number) {
    const start = Math.floor(this.now() / 1000 / seconds) * seconds;
    const w = this.windows.get(key);
    if (w && w.start === start) w.hits++;
    else this.windows.set(key, { start, hits: 1 });
    return Promise.resolve(this.windows.get(key)!.hits);
  }
}

/** Counts in the rate_limits table through the rate_limit_hit() database function. */
export class SupabaseRateLimiter implements RateLimiter {
  constructor(private db: SupabaseClient) {}

  async hit(key: string, seconds: number) {
    const { data, error } = await this.db.rpc("rate_limit_hit", {
      p_key: key,
      p_seconds: seconds,
    });
    if (error) throw new Error(error.message);
    return data as number;
  }
}

/**
 * The client's address as a rate-limit key: an IPv4 address, or the /64 network of an IPv6
 * address (one device usually has a whole /64 and could rotate through it). Supabase passes
 * the caller's address in x-forwarded-for; without one, all requests share the key "unknown".
 */
export function clientAddress(req: Request): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip")?.trim() || "";
  const v4 = /^(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (v4 || !ip.includes(":")) return v4 ?? (ip || "unknown");
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = [
    ...left,
    ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"),
    ...right,
  ];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

/** Hashes addresses with an HMAC keyed by `secret`, so the counters table holds no
 *  readable (or brute-forceable) IPs. */
export function addressHasher(secret: string): (address: string) => Promise<string> {
  const enc = new TextEncoder();
  const key = crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return async (address) => {
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await key, enc.encode(address)));
    return [...mac.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
}
