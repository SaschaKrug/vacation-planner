-- Import: replaces all types, entries and notes of a planner in one transaction, so a
-- failed import leaves the planner as it was (see SupabaseStore.replaceContents).

create or replace function public.replace_session_contents(
  p_session_id text,
  p_types jsonb,
  p_entries jsonb,
  p_notes jsonb
)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from public.day_notes where session_id = p_session_id;
  -- day_entries rows go away through the ON DELETE CASCADE foreign key.
  delete from public.entry_types where session_id = p_session_id;

  insert into public.entry_types (session_id, year, id, name, color, role, "position")
  select p_session_id, t.year, t.id, t.name, t.color, t.role, t."position"
  from jsonb_to_recordset(p_types)
    as t(year integer, id text, name text, color text, role text, "position" integer);

  insert into public.day_entries (session_id, day, type_id)
  select p_session_id, e.day, e.type_id
  from jsonb_to_recordset(p_entries) as e(day date, type_id text);

  insert into public.day_notes (session_id, day, icon, comment)
  select p_session_id, n.day, n.icon, n.comment
  from jsonb_to_recordset(p_notes) as n(day date, icon text, comment text);

  update public.sessions set updated_at = now() where id = p_session_id;
end;
$$;

-- Only the Edge Function (service role) may call it.
revoke execute on function public.replace_session_contents(text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_session_contents(text, jsonb, jsonb, jsonb)
  to service_role;
