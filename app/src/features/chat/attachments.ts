// Files and screenshots attached to a chat message: images are shrunk to a JPEG data URL, text
// files are read as text. Both go to the assistant as OpenAI content parts.

import { toast } from "sonner";
import type { ChatMessage, ContentPart } from "@/lib/api";
import { t } from "@/lib/i18n";

export type Attachment =
  | { kind: "image"; name: string; url: string }
  | { kind: "file"; name: string; text: string; size: number };

export const MAX_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 50_000;
const MAX_SIDE = 1600;
const MAX_URL = 2_000_000;

const TEXT_TYPES = ["application/json", "application/xml"];
const TEXT_EXTS = [
  "txt",
  "csv",
  "tsv",
  "md",
  "json",
  "ics",
  "xml",
  "html",
  "log",
  "yaml",
  "yml",
];

/** For the file picker. */
export const ACCEPT = ["image/*", ...TEXT_EXTS.map((e) => `.${e}`)].join(",");

/** What a file can be attached as, or null if it can't. */
export function kindOf(file: File): Attachment["kind"] | null {
  if (file.type.startsWith("image/")) return "image";
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (
    file.type.startsWith("text/") || TEXT_TYPES.includes(file.type) ||
    TEXT_EXTS.includes(ext)
  ) {
    return "file";
  }
  return null;
}

/** Reads a file into an attachment; throws an Error with a message for the user. */
export async function readAttachment(file: File): Promise<Attachment> {
  const name = file.name || "file";
  const kind = kindOf(file);
  if (!kind) throw new Error(t("chat.attach_unsupported", { name }));
  if (kind === "image") {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(t("chat.attach_too_big", { name, max: 20 }));
    }
    return { kind, name, url: await toJpeg(file, name) };
  }
  if (file.size > MAX_TEXT_BYTES) {
    throw new Error(t("chat.attach_too_big", { name, max: 2 }));
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error(t("chat.attach_unreadable", { name }));
  }
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS) + "\n…(cut off)";
    toast(t("chat.attach_cut", { name }));
  }
  return { kind, name, text, size: file.size };
}

/** Downscales an image (long side ≤ 1600px) onto white and exports it as a JPEG data URL. */
async function toJpeg(file: File, name: string): Promise<string> {
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = src;
    try {
      await img.decode();
    } catch {
      throw new Error(t("chat.attach_unreadable", { name }));
    }
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error(t("chat.attach_unreadable", { name }));
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(t("chat.attach_unreadable", { name }));
    // Still too big for the server: try smaller and with lower quality.
    for (
      let side = MAX_SIDE, q = 0.85;
      side >= 400;
      side = Math.round(side * 0.75), q -= 0.1
    ) {
      const scale = Math.min(1, side / Math.max(w, h));
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      ctx.fillStyle = "#fff"; // transparency would turn black
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL("image/jpeg", q);
      if (url.length <= MAX_URL) return url;
    }
    throw new Error(t("chat.attach_too_big", { name, max: 20 }));
  } finally {
    URL.revokeObjectURL(src);
  }
}

/** The content of a user message: the typed text, then the text files, then the images. */
export function toParts(text: string, list: Attachment[]): ContentPart[] {
  const parts: ContentPart[] = [];
  if (text) parts.push({ type: "text", text });
  for (const a of list) {
    if (a.kind === "file") {
      parts.push({
        type: "text",
        text: `Attached file “${a.name}”:\n\`\`\`\n${a.text}\n\`\`\``,
      });
    }
  }
  for (const a of list) {
    if (a.kind === "image") {
      parts.push({ type: "image_url", image_url: { url: a.url } });
    }
  }
  return parts;
}

/** The history with only the newest `keep` images; older ones become the text `note`. */
export function keepImages(
  history: ChatMessage[],
  keep: number,
  note: string,
): ChatMessage[] {
  let n = 0;
  return history.slice().reverse().map((m) =>
    Array.isArray(m.content)
      ? {
        ...m,
        content: m.content.slice().reverse().map((p): ContentPart =>
          p.type === "image_url" && ++n > keep ? { type: "text", text: note } : p
        ).reverse(),
      }
      : m
  ).reverse();
}
