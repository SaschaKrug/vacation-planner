// Thin client for the Family Planner API (Supabase Edge Function "api").

import type { EntryOp, EntryType, NoteOp, Role } from "./core";

declare global {
  interface Window {
    FP_CONFIG?: { apiBase?: string };
  }
}

export type Access = "edit" | "view" | "calendar";

export interface Family {
  id?: string;
  readId?: string;
  feedId: string;
  legacyId?: string;
  name: string;
  access: Access;
  readOnly: boolean;
  updatedAt: string;
}

export interface FamilyState {
  family: Family;
  types: EntryType[];
  typeYears?: number[];
  entries: Record<string, string[]>;
  notes?: Record<string, { icon: string; comment: string }>;
}

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

const base = (window.FP_CONFIG?.apiBase ?? "/api").replace(/\/+$/, "");

export function apiBase(): string {
  return new URL(base, location.href).href.replace(/\/+$/, "");
}

export function isConfigured(): boolean {
  return !!window.FP_CONFIG?.apiBase;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiBase() + path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError((err as Error).message); // offline: no status
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

const enc = encodeURIComponent;
const fam = (token: string) => `/families/${enc(token)}`;

export const api = {
  createFamily: (body: { name?: string; lang?: string; year?: number } = {}) =>
    request<FamilyState>("POST", "/families", body),
  getFamily: (token: string, year: number) =>
    request<FamilyState>("GET", `${fam(token)}?year=${year}`),
  renameFamily: (token: string, name: string) =>
    request<FamilyState>("PATCH", fam(token), { name }),
  rotateLink: (token: string, link: "view" | "feed" | "legacy", year: number) =>
    request<FamilyState>("POST", `${fam(token)}/links?year=${year}`, { link }),
  cloneFamily: (token: string, name: string) =>
    request<FamilyState>("POST", `${fam(token)}/clone`, { name }),
  exportFamily: (token: string) => request<Record<string, unknown>>("GET", `${fam(token)}/export`),
  importFamily: (token: string, year: number, file: unknown) =>
    request<FamilyState>("POST", `${fam(token)}/import?year=${year}`, file),
  addType: (
    token: string,
    year: number,
    type: { name: string; color: string; role: Role },
  ) => request<EntryType>("POST", `${fam(token)}/types?year=${year}`, type),
  updateType: (
    token: string,
    year: number,
    id: string,
    patch: Partial<EntryType>,
  ) =>
    request<EntryType>(
      "PATCH",
      `${fam(token)}/types/${enc(id)}?year=${year}`,
      patch,
    ),
  deleteType: (token: string, year: number, id: string) =>
    request<unknown>("DELETE", `${fam(token)}/types/${enc(id)}?year=${year}`),
  copyTypes: (token: string, from: number, to: number) =>
    request<EntryType[]>("POST", `${fam(token)}/types/copy`, { from, to }),
  applyOps: (token: string, ops: EntryOp[]) =>
    request<unknown>("POST", `${fam(token)}/entries`, { ops }),
  applyNoteOps: (token: string, ops: NoteOp[]) =>
    request<unknown>("POST", `${fam(token)}/notes`, { ops }),
  agentUrl: (token: string) => `${apiBase()}${fam(token)}/agent`,
  calendarUrl: (feedId: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return `${apiBase()}${fam(feedId)}/calendar.ics${qs ? "?" + qs : ""}`;
  },
};
