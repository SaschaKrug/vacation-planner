-- Messages written while the assistant still answers wait in the chat's queue: each goes next
-- once the turn is over (also when the app is closed meanwhile). An entry is {id, item, content,
-- context}: what the chat shows, what the model gets, and where the user was. Adding and taking
-- out happen in one statement each, so a message is neither lost nor taken twice.

alter table public.ai_chats
  add column if not exists queue jsonb not null default '[]';

-- Adds an entry to the end of the queue; the chat after (none if it is gone).
create or replace function public.ai_chat_queue_push(p_chat text, p_entry jsonb)
returns setof public.ai_chats
language sql
set search_path = public
as $$
  update public.ai_chats set queue = queue || jsonb_build_array(p_entry)
  where id = p_chat
  returning *;
$$;

-- Takes the entry p_id out of the queue; the chat after, none if the entry is no longer there
-- (the turn took it, or the user took it back).
create or replace function public.ai_chat_queue_take(p_chat text, p_id text)
returns setof public.ai_chats
language sql
set search_path = public
as $$
  update public.ai_chats
  set queue = coalesce(
    (
      select jsonb_agg(e order by n)
      from jsonb_array_elements(queue) with ordinality as q (e, n)
      where e ->> 'id' <> p_id
    ),
    '[]'::jsonb
  )
  where id = p_chat
    and exists (select 1 from jsonb_array_elements(queue) e where e ->> 'id' = p_id)
  returning *;
$$;

revoke execute on function public.ai_chat_queue_push(text, jsonb) from public, anon, authenticated;
revoke execute on function public.ai_chat_queue_take(text, text) from public, anon, authenticated;
grant execute on function public.ai_chat_queue_push(text, jsonb) to service_role;
grant execute on function public.ai_chat_queue_take(text, text) to service_role;
