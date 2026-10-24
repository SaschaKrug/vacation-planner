-- Family Planner: a planner ("session") becomes a family. Tables and columns are renamed in
-- place, so all data stays.
--
-- Links: a family has an edit id (`id`), a view id (`read_id`, everything read-only) and a
-- feed id (`feed_id`, only the calendar feed). The view link will show more than the calendar
-- (finances), so the view id of every existing planner becomes its `legacy_id`: it keeps
-- working for everything it was shared for (the read-only calendar and calendar feeds), but
-- never sees anything new. Those families get a new view id and feed id.

alter table public.sessions rename to families;
alter table public.families alter column name set default 'Family';
alter table public.entry_types rename column session_id to family_id;
alter table public.day_entries rename column session_id to family_id;
alter table public.day_notes rename column session_id to family_id;

alter table public.families
  add column if not exists feed_id text unique,
  add column if not exists legacy_id text unique;

-- 32 hex characters (122 random bits): alphanumeric, as the API expects of every token.
update public.families
set legacy_id = read_id,
    read_id = replace(gen_random_uuid()::text, '-', ''),
    feed_id = replace(gen_random_uuid()::text, '-', '')
where feed_id is null;

alter table public.families alter column feed_id set not null;

-- Import: same as before, with the new names.
drop function if exists public.replace_session_contents(text, jsonb, jsonb, jsonb);

create or replace function public.replace_family_contents(
  p_family_id text,
  p_types jsonb,
  p_entries jsonb,
  p_notes jsonb
)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from public.day_notes where family_id = p_family_id;
  -- day_entries rows go away through the ON DELETE CASCADE foreign key.
  delete from public.entry_types where family_id = p_family_id;

  insert into public.entry_types (family_id, year, id, name, color, role, "position")
  select p_family_id, t.year, t.id, t.name, t.color, t.role, t."position"
  from jsonb_to_recordset(p_types)
    as t(year integer, id text, name text, color text, role text, "position" integer);

  insert into public.day_entries (family_id, day, type_id)
  select p_family_id, e.day, e.type_id
  from jsonb_to_recordset(p_entries) as e(day date, type_id text);

  insert into public.day_notes (family_id, day, icon, comment)
  select p_family_id, n.day, n.icon, n.comment
  from jsonb_to_recordset(p_notes) as n(day date, icon text, comment text);

  update public.families set updated_at = now() where id = p_family_id;
end;
$$;

-- Only the Edge Function (service role) may call it.
revoke execute on function public.replace_family_contents(text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_family_contents(text, jsonb, jsonb, jsonb)
  to service_role;
