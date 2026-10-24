-- AI assistant settings per family: an OpenAI-compatible endpoint and model, and an optional
-- web search provider. The keys are encrypted by the Edge Function (AES-GCM, AI_CONFIG_KEY)
-- before they get here, and are never sent back to the app.

create table if not exists public.ai_settings (
  family_id text primary key references public.families (id) on delete cascade,
  base_url text not null default '',
  model text not null default '',
  api_key_enc text not null default '',
  search_provider text not null default 'none'
    check (search_provider in ('none', 'tavily', 'brave')),
  search_key_enc text not null default '',
  allow_writes boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.ai_settings enable row level security;

revoke all on public.ai_settings from anon, authenticated;
