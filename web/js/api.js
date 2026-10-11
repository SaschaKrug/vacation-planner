// Thin client for the planner API (Supabase Edge Function "api").

const base = (window.VP_CONFIG?.apiBase ?? "/api").replace(/\/+$/, "");

export function apiBase() {
  return new URL(base, location.href).href.replace(/\/+$/, "");
}

export function isConfigured() {
  return !!window.VP_CONFIG?.apiBase;
}

async function request(method, path, body) {
  const res = await fetch(apiBase() + path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const enc = encodeURIComponent;

export const api = {
  createSession: (body = {}) => request("POST", "/sessions", body),
  getSession: (token, year) => request("GET", `/sessions/${enc(token)}?year=${year}`),
  renameSession: (token, name) => request("PATCH", `/sessions/${enc(token)}`, { name }),
  addType: (token, year, type) =>
    request("POST", `/sessions/${enc(token)}/types?year=${year}`, type),
  updateType: (token, year, id, patch) =>
    request("PATCH", `/sessions/${enc(token)}/types/${enc(id)}?year=${year}`, patch),
  deleteType: (token, year, id) =>
    request("DELETE", `/sessions/${enc(token)}/types/${enc(id)}?year=${year}`),
  copyTypes: (token, from, to) =>
    request("POST", `/sessions/${enc(token)}/types/copy`, { from, to }),
  applyOps: (token, ops) => request("POST", `/sessions/${enc(token)}/entries`, { ops }),
  applyNoteOps: (token, ops) => request("POST", `/sessions/${enc(token)}/notes`, { ops }),
  calendarUrl: (readId, params) => {
    const qs = new URLSearchParams(params).toString();
    return `${apiBase()}/sessions/${enc(readId)}/calendar.ics${qs ? "?" + qs : ""}`;
  },
};
