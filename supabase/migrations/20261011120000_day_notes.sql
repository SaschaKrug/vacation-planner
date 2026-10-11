-- Day notes: an icon (emoji) and/or a comment on a calendar day, e.g. 🎄 Christmas.
-- Independent of entry types: no role, no effect on coverage. One note per day.

create table if not exists public.day_notes (
  session_id text not null references public.sessions (id) on delete cascade,
  day date not null,
  icon text not null default '',
  comment text not null default '',
  primary key (session_id, day),
  -- The API limits icon to 16 UTF-16 code units; char_length counts code points,
  -- so the database check is looser and only guards against abuse.
  check (char_length(icon) <= 32),
  check (char_length(comment) <= 500),
  check (icon <> '' or comment <> '')
);

alter table public.day_notes enable row level security;

revoke all on public.day_notes from anon, authenticated;
