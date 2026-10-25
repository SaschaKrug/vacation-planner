// What a request about one family gets from the router: the store, the request, who is asking,
// and the family lookup with access checks.

import type { Principal } from "./auth.ts";
import type { FamilyRow, MemberRole, Store } from "./store.ts";

/**
 * What a request may do, from most to least:
 * - `edit`: everything (an editor of the family)
 * - `view`: read everything (a viewer)
 * - `feed`: only the calendar feed (the feed id, or the legacy id, without signing in)
 */
export type Access = "edit" | "view" | "feed";

export const ACCESS_RANK: Record<Access, number> = { feed: 0, view: 1, edit: 2 };

export function accessOf(role: MemberRole): Access {
  return role === "editor" ? "edit" : "view";
}

export interface Loaded {
  family: FamilyRow;
  access: Access;
}

export interface Ctx {
  store: Store;
  req: Request;
  url: URL;
  method: string;
  /** The id in the path: /families/{id}/... (the feed or legacy id for calendar.ics) */
  token: string;
  /** The path parts after the id. */
  rest: string[];
  /** Absolute API base for links, e.g. https://<project>.supabase.co/functions/v1/api */
  publicBase: string;
  /** Who is asking; null without signing in (only the calendar feed allows that). */
  principal: Principal | null;
  /** The signed-in user; 401 without one. */
  requireUser(): Principal;
  /** Loads the family; 404 unless the user is a member, 403 unless the role gives `need`. */
  load(need: Access): Promise<Loaded>;
  /** Like load, and runs `query` for the family's id alongside the lookup. */
  loadWith<T>(need: Access, query: (familyId: string) => Promise<T>): Promise<[Loaded, T]>;
}
