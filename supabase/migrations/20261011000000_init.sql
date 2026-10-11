-- Vacation planner schema. All access goes through the "api" Edge Function
-- (service role); RLS without policies keeps the tables closed to anon users.

create table if not exists public.sessions (
  id text primary key,
  read_id text not null unique,
  name text not null default 'Vacation planner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.entry_types (
  session_id text not null references public.sessions (id) on delete cascade,
  id text not null,
  name text not null,
  color text not null,
  role text not null default 'none'
    check (role in ('none', 'needs_cover', 'covers', 'day_off')),
  position integer not null default 0,
  primary key (session_id, id)
);

create table if not exists public.day_entries (
  session_id text not null,
  day date not null,
  type_id text not null,
  primary key (session_id, day, type_id),
  foreign key (session_id, type_id)
    references public.entry_types (session_id, id) on delete cascade
);

alter table public.sessions enable row level security;
alter table public.entry_types enable row level security;
alter table public.day_entries enable row level security;

revoke all on public.sessions, public.entry_types, public.day_entries from anon, authenticated;
