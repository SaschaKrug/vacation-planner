// Who is signed in on this device: the session token (localStorage) and the account with its
// families (GET /auth/me). Every API request sends the token; a 401 signs out here.

import { useSyncExternalStore } from "react";
import { read, write } from "./storage";

const TOKEN_KEY = "fp-session";
const LAST_FAMILY_KEY = "fp-last-family";

export type MemberRole = "editor" | "viewer";

export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
  hasPassword: boolean;
  passkeys: number;
}

export interface MyFamily {
  id: string;
  name: string;
  role: MemberRole;
}

export interface Me {
  user: User;
  families: MyFamily[];
}

interface State {
  token: string | null;
  /** null until loaded (or without a session). */
  me: Me | null;
}

let state: State = { token: read<string | null>(TOKEN_KEY, null), me: null };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function sessionToken(): string | null {
  return state.token;
}

export function getAuth(): State {
  return state;
}

/** Signed in: keeps the token and the account. */
export function setSession(token: string, me: Me) {
  write(TOKEN_KEY, token);
  set({ token, me });
}

export function setMe(me: Me) {
  set({ me });
}

/** Forgets the session and what this device kept of the families (cached calendars, chats
 *  from before they were stored on the server). */
export function clearSession() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (
        key === TOKEN_KEY || key === LAST_FAMILY_KEY || key === "fp-cache" ||
        key.startsWith("fp-chats:") || key === "fp-recent" ||
        key === "vp-recent"
      ) localStorage.removeItem(key);
    }
  } catch {
    // storage blocked
  }
  set({ token: null, me: null });
}

/** The account; the component re-renders when it changes. */
export function useAuth(): State {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, getAuth);
}

/** Whether the account still has to be set up: the initial password changed, or a first way
 *  to sign in added (after a setup link). */
export function needsSetup(user: User): boolean {
  return user.mustChangePassword || (!user.hasPassword && user.passkeys === 0);
}

/** The family opened last on this device, to open it again. */
export function lastFamily(): string | null {
  return read<string | null>(LAST_FAMILY_KEY, null);
}

/** A family the user can't open (any more): out of the list, so nothing opens it again. */
export function forgetFamily(id: string) {
  if (lastFamily() === id) write(LAST_FAMILY_KEY, null);
  const me = state.me;
  if (me?.families.some((f) => f.id === id)) {
    set({ me: { ...me, families: me.families.filter((f) => f.id !== id) } });
  }
}

export function rememberFamily(id: string, name?: string) {
  write(LAST_FAMILY_KEY, id);
  // A rename shows in the switcher right away.
  const me = state.me;
  if (name && me?.families.some((f) => f.id === id && f.name !== name)) {
    set({
      me: {
        ...me,
        families: me.families.map((f) => (f.id === id ? { ...f, name } : f)),
      },
    });
  }
}
