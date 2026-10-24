// What a request about one family gets from the router: the store, the request and the
// family lookup with access checks.

import type { FamilyRow, Store } from "./store.ts";

/**
 * What a token may do, from most to least:
 * - `edit`: everything (the edit id)
 * - `view`: read everything (the view id)
 * - `calendar`: read the calendar and its feed (the view id of a planner from before families)
 * - `feed`: only the calendar feed (the feed id)
 */
export type Access = "edit" | "view" | "calendar" | "feed";

export const ACCESS_RANK: Record<Access, number> = { feed: 0, calendar: 1, view: 2, edit: 3 };

export interface Loaded {
  family: FamilyRow;
  access: Access;
}

export interface Ctx {
  store: Store;
  req: Request;
  url: URL;
  method: string;
  /** The token in the path: /families/{token}/... */
  token: string;
  /** The path parts after the token. */
  rest: string[];
  /** Absolute API base for links, e.g. https://<project>.supabase.co/functions/v1/api */
  publicBase: string;
  /** Loads the family; 403 unless the token gives at least `need`. */
  load(need: Access): Promise<Loaded>;
  /** Like load, and runs `query` for the family's id alongside the lookup. */
  loadWith<T>(need: Access, query: (familyId: string) => Promise<T>): Promise<[Loaded, T]>;
}

export function accessOf(family: FamilyRow, token: string): Access {
  if (token === family.id) return "edit";
  if (token === family.read_id) return "view";
  if (token === family.legacy_id) return "calendar";
  return "feed";
}
