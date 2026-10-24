// Encrypts the AI and search API keys before they are stored (AES-GCM with a 256-bit key from
// the AI_CONFIG_KEY secret). Stored as "v1:<base64 of 12-byte IV + ciphertext>".

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export class SecretBox {
  private key: Promise<CryptoKey>;

  /** `secret`: 32 random bytes as base64 (e.g. `openssl rand -base64 32`). */
  constructor(secret: string) {
    const raw = fromBase64(secret.trim());
    if (raw.length !== 32) throw new Error("AI_CONFIG_KEY must be 32 bytes, base64-encoded");
    this.key = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  async seal(plain: string): Promise<string> {
    if (!plain) return "";
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await this.key,
      new TextEncoder().encode(plain),
    );
    const out = new Uint8Array(12 + data.byteLength);
    out.set(iv);
    out.set(new Uint8Array(data), 12);
    return "v1:" + toBase64(out);
  }

  async open(sealed: string): Promise<string> {
    if (!sealed) return "";
    if (!sealed.startsWith("v1:")) throw new Error("Unknown secret format");
    const bytes = fromBase64(sealed.slice(3));
    const data = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) },
      await this.key,
      bytes.slice(12),
    );
    return new TextDecoder().decode(data);
  }
}

/** A random key for local development and tests (stored keys don't survive a restart). */
export function devSecret(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}
