-- Long AI chats: the older part of a chat is condensed into a summary before it no longer fits
-- into the model's context window (stored among the chat's messages). The family can set the
-- window; 0 finds it out from the endpoint's model list. Each chat keeps how full the context
-- was at its last step, for the app to show.

alter table public.ai_settings
  add column if not exists context_window integer not null default 0;

alter table public.ai_chats
  add column if not exists usage jsonb;
