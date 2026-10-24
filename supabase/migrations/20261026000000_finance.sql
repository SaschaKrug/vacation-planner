-- Finance: transaction categories, transactions and per-family settings (currency, saved
-- CSV column mappings). All access goes through the "api" Edge Function (service role).

create table if not exists public.family_settings (
  family_id text primary key references public.families (id) on delete cascade,
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  csv_mappings jsonb not null default '[]'::jsonb
);

create table if not exists public.finance_categories (
  family_id text not null references public.families (id) on delete cascade,
  id text not null,
  name text not null,
  color text not null,
  icon text not null default '',
  kind text not null default 'expense' check (kind in ('income', 'expense', 'both')),
  position integer not null default 0,
  primary key (family_id, id)
);

create table if not exists public.transactions (
  family_id text not null references public.families (id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  day date not null,
  -- Signed: negative is money going out.
  amount_cents bigint not null check (abs(amount_cents) <= 100000000000000),
  payee text not null default '' check (char_length(payee) <= 200),
  description text not null default '' check (char_length(description) <= 500),
  category_id text,
  note text not null default '' check (char_length(note) <= 500),
  -- Set for imported rows, so importing the same statement again skips them.
  import_hash text,
  created_at timestamptz not null default now(),
  primary key (family_id, id),
  foreign key (family_id, category_id)
    references public.finance_categories (family_id, id) on delete set null (category_id)
);

create index if not exists transactions_family_day on public.transactions (family_id, day);
create unique index if not exists transactions_family_import_hash
  on public.transactions (family_id, import_hash) where import_hash is not null;

alter table public.family_settings enable row level security;
alter table public.finance_categories enable row level security;
alter table public.transactions enable row level security;

revoke all on public.family_settings, public.finance_categories, public.transactions
  from anon, authenticated;

-- Import: replaces the calendar and, when p_finance is not null, the finances of a family in
-- one transaction, so a failed import leaves the family as it was.
drop function if exists public.replace_family_contents(text, jsonb, jsonb, jsonb);

create or replace function public.replace_family_contents(
  p_family_id text,
  p_types jsonb,
  p_entries jsonb,
  p_notes jsonb,
  p_finance jsonb default null
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

  if p_finance is not null then
    delete from public.transactions where family_id = p_family_id;
    delete from public.finance_categories where family_id = p_family_id;

    insert into public.finance_categories (family_id, id, name, color, icon, kind, "position")
    select p_family_id, c.id, c.name, c.color, c.icon, c.kind, c."position"
    from jsonb_to_recordset(p_finance -> 'categories')
      as c(id text, name text, color text, icon text, kind text, "position" integer);

    insert into public.transactions
      (family_id, id, day, amount_cents, payee, description, category_id, note, import_hash)
    select p_family_id, x.id, x.day, x.amount_cents, x.payee, x.description, x.category_id,
      x.note, x.import_hash
    from jsonb_to_recordset(p_finance -> 'transactions')
      as x(id uuid, day date, amount_cents bigint, payee text, description text,
        category_id text, note text, import_hash text);

    insert into public.family_settings (family_id, currency)
    values (p_family_id, coalesce(p_finance ->> 'currency', 'EUR'))
    on conflict (family_id) do update set currency = excluded.currency;
  end if;

  update public.families set updated_at = now() where id = p_family_id;
end;
$$;

revoke execute on function public.replace_family_contents(text, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_family_contents(text, jsonb, jsonb, jsonb, jsonb)
  to service_role;
