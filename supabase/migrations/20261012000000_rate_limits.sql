-- Request counters for the API's rate limits (see supabase/functions/_shared/rate_limit.ts).
-- One row per key and fixed time window; keys hold a keyed hash of the client's address,
-- never the address itself. Rows older than a day are deleted along the way.

create table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 1,
  primary key (key, window_start)
);

alter table public.rate_limits enable row level security;

revoke all on public.rate_limits from anon, authenticated;

-- Counts a hit for p_key in the current window of p_seconds and returns the window's hits.
create or replace function public.rate_limit_hit(p_key text, p_seconds integer)
returns integer
language plpgsql
set search_path = public
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_seconds) * p_seconds);
  n integer;
begin
  insert into public.rate_limits as r (key, window_start) values (p_key, w)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into n;
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return n;
end;
$$;

-- Only the Edge Function (service role) may count; anon users must not reset or fill it.
revoke execute on function public.rate_limit_hit(text, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer) to service_role;
