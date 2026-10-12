-- Entry types belong to a year: every year of a planner has its own set, and a day's
-- entries can only use the types of that day's year. Existing types are copied into
-- every year that has entries, plus the current year, so existing planners look the same.

alter table public.day_entries drop constraint if exists day_entries_session_id_type_id_fkey;
alter table public.entry_types drop constraint if exists entry_types_pkey;
alter table public.entry_types add column if not exists year integer;

insert into public.entry_types (session_id, year, id, name, color, role, position)
select t.session_id, y.year, t.id, t.name, t.color, t.role, t.position
from public.entry_types t
join (
  select distinct session_id, extract(year from day)::integer as year from public.day_entries
  union
  select id, extract(year from now())::integer from public.sessions
) y on y.session_id = t.session_id
where t.year is null;

delete from public.entry_types where year is null;

alter table public.entry_types
  alter column year set not null,
  add primary key (session_id, year, id);

alter table public.day_entries
  add column year integer generated always as (extract(year from day)::integer) stored;

alter table public.day_entries
  add foreign key (session_id, year, type_id)
    references public.entry_types (session_id, year, id) on delete cascade;
