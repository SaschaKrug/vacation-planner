// Password hashes and token hashes (WebCrypto only, so it runs the same on Supabase and Deno).
// A password hash is "pbkdf2-sha256$<iterations>$<salt>$<hash>" (base64): the iterations are
// stored with it, so they can grow later without breaking older hashes.

/** OWASP's recommendation for PBKDF2-HMAC-SHA256. */
export const PASSWORD_ITERATIONS = 600_000;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;

const enc = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(
  password: string,
  iterations = PASSWORD_ITERATIONS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2-sha256" || !salt || !hash) return false;
  const actual = await pbkdf2(password, fromBase64(salt), Number(iterations));
  const expected = fromBase64(hash);
  if (actual.length !== expected.length) return false;
  let diff = 0; // constant time
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/** SHA-256 of a token, hex: what is stored instead of the token. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
