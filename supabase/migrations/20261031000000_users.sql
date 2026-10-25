-- Accounts: users sign in with a passkey or a password, and see the families they are members
-- of (as editor or viewer). The secret family links stop granting access: the family id is
-- only an id now, and the view id goes away. Only the calendar feed (feed id, and the legacy
-- id of planners from before families) stays public, as calendar apps can't sign in.
--
-- No user exists after this migration: the API creates "admin" (password "admin", to be
-- changed at the first sign-in) when it finds no users, and makes it an editor of every
-- family that exists then. The admin assigns the families to their people from there.

create table if not exists public.users (
  id text primary key,
  -- The sign-in name: an email address, or a plain name like "admin". Stored lowercase.
  email text not null unique,
  name text not null default '',
  -- "pbkdf2-sha256$<iterations>$<salt>$<hash>" (base64); null: no password, passkeys only.
  password_hash text,
  is_admin boolean not null default false,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Sessions of the app, personal API tokens and one-time setup links. Only a SHA-256 hash of
-- the token is stored.
create table if not exists public.auth_tokens (
  id text primary key,
  hash text not null unique,
  user_id text not null references public.users (id) on delete cascade,
  kind text not null check (kind in ('session', 'api', 'setup')),
  name text not null default '',
  -- A session opened with a setup link may set a new password without the current one.
  can_reset boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz
);

create index if not exists auth_tokens_user on public.auth_tokens (user_id, kind);

create table if not exists public.passkeys (
  -- The credential id (base64url).
  id text primary key,
  user_id text not null references public.users (id) on delete cascade,
  public_key text not null, -- COSE key, base64url
  counter bigint not null default 0,
  transports text[] not null default '{}',
  -- The host the passkey belongs to (the app's domain).
  rp_id text not null,
  name text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists passkeys_user on public.passkeys (user_id);

-- WebAuthn challenges, used once within a few minutes.
create table if not exists public.auth_challenges (
  id text primary key,
  challenge text not null,
  user_id text references public.users (id) on delete cascade,
  rp_id text not null,
  origin text not null,
  expires_at timestamptz not null
);

create table if not exists public.family_members (
  family_id text not null references public.families (id) on delete cascade,
  user_id text not null references public.users (id) on delete cascade,
  role text not null check (role in ('editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

create index if not exists family_members_user on public.family_members (user_id);

-- The view link is gone: viewers are members now.
alter table public.families drop column if exists read_id;

alter table public.users enable row level security;
alter table public.auth_tokens enable row level security;
alter table public.passkeys enable row level security;
alter table public.auth_challenges enable row level security;
alter table public.family_members enable row level security;

revoke all on public.users, public.auth_tokens, public.passkeys, public.auth_challenges,
  public.family_members from anon, authenticated;
