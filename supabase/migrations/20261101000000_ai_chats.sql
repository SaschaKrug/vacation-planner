-- The AI chats live on the server: a turn runs in the Edge Function whether or not the app is
-- open, and every device of the user sees the same chats. Per chat: what the chat shows (items,
-- each with the revision it last changed in, so the app fetches only what changed) and what the
-- model gets back (messages, only ever appended).

create table if not exists public.ai_chats (
  id text primary key,
  family_id text not null references public.families (id) on delete cascade,
  -- Whose chat it is: only they see it.
  user_id text not null references public.users (id) on delete cascade,
  title text not null default '',
  status text not null default 'idle' check (status in ('idle', 'running')),
  -- The running turn: the invocation holding run_token runs it, until run_until (renewed while
  -- it works); after that, another one may take it over.
  run_token text,
  run_until timestamptz,
  -- The user asked to stop the running turn.
  stop boolean not null default false,
  -- Failed tries of the running step.
  retries integer not null default 0,
  -- Page, year, language and day of the latest message, for the assistant's instructions.
  context jsonb not null default '{}',
  -- What the running turn does right now ("thinking", "writing", "tool", "retrying").
  activity jsonb,
  -- Changes the user undid, which the assistant hears with the next message.
  notes jsonb not null default '[]',
  -- Counts the changes of the items.
  rev bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_chats_owner on public.ai_chats (family_id, user_id, updated_at desc);

create table if not exists public.ai_chat_items (
  chat_id text not null references public.ai_chats (id) on delete cascade,
  seq integer not null,
  rev bigint not null,
  item jsonb not null,
  primary key (chat_id, seq)
);

create index if not exists ai_chat_items_rev on public.ai_chat_items (chat_id, rev);

create table if not exists public.ai_chat_messages (
  chat_id text not null references public.ai_chats (id) on delete cascade,
  seq integer not null,
  message jsonb not null,
  primary key (chat_id, seq)
);

alter table public.ai_chats enable row level security;
alter table public.ai_chat_items enable row level security;
alter table public.ai_chat_messages enable row level security;

revoke all on public.ai_chats, public.ai_chat_items, public.ai_chat_messages
  from anon, authenticated;

-- Inserts or replaces items ([{seq, item}]) of a chat; they get the chat's next revision, which
-- is returned (null if the chat is gone). The chat's row lock orders the revisions, so whoever
-- has seen revision n has seen every change up to it.
create or replace function public.ai_chat_put_items(p_chat text, p_items jsonb)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_rev bigint;
begin
  update public.ai_chats set rev = rev + 1, updated_at = now() where id = p_chat
  returning rev into v_rev;
  if v_rev is null then
    return null;
  end if;
  insert into public.ai_chat_items (chat_id, seq, rev, item)
  select p_chat, (e ->> 'seq')::integer, v_rev, e -> 'item'
  from jsonb_array_elements(p_items) e
  on conflict (chat_id, seq) do update set rev = excluded.rev, item = excluded.item;
  return v_rev;
end;
$$;

revoke execute on function public.ai_chat_put_items(text, jsonb) from public, anon, authenticated;
grant execute on function public.ai_chat_put_items(text, jsonb) to service_role;
