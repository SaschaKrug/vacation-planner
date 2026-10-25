// Accounts for tests: users made directly in the store, with a session token to call as them.

import { issueToken } from "../supabase/functions/_shared/auth.ts";
import { randomToken } from "../supabase/functions/_shared/http.ts";
import type { MemberRole, MemoryStore, UserRow } from "../supabase/functions/_shared/store.ts";

/** Few iterations: the tests hash many passwords. */
export const TEST_ITERATIONS = 1000;

export async function addUser(
  store: MemoryStore,
  email: string,
  extra: Partial<UserRow> = {},
): Promise<{ user: UserRow; token: string }> {
  const now = new Date().toISOString();
  const user: UserRow = {
    id: randomToken(20),
    email,
    name: "",
    password_hash: null,
    is_admin: false,
    must_change_password: false,
    created_at: now,
    updated_at: now,
    ...extra,
  };
  await store.createUser(user);
  const { token } = await issueToken(store, user.id, "session");
  return { user, token };
}

export function addMember(store: MemoryStore, familyId: string, userId: string, role: MemberRole) {
  return store.setMember({
    family_id: familyId,
    user_id: userId,
    role,
    created_at: new Date().toISOString(),
  });
}
