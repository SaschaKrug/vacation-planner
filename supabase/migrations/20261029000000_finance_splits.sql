-- Split bookings: a transaction may be a part of another one (its booking), e.g. the order
-- lines of an Amazon "Splitbuchung" that the bank exports next to the booking itself. Totals
-- count the parts and what is left of the booking; balances count only the booking. Deleting
-- a booking keeps its parts as normal transactions.

alter table public.transactions add column if not exists split_of uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_split_of_fkey'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_split_of_fkey foreign key (family_id, split_of)
      references public.transactions (family_id, id) on delete set null (split_of);
  end if;
end;
$$;

create index if not exists transactions_family_split_of
  on public.transactions (family_id, split_of) where split_of is not null;

-- Sum of all transactions per account (all time), for the balances; parts don't count.
create or replace view public.finance_account_totals
with (security_invoker = true) as
select family_id, account_id, sum(amount_cents)::bigint as total_cents
from public.transactions
where account_id is not null and split_of is null
group by family_id, account_id;

revoke all on public.finance_account_totals from anon, authenticated;

-- Import: as before, plus the transactions' booking.
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
    delete from public.finance_accounts where family_id = p_family_id;
    delete from public.finance_categories where family_id = p_family_id;

    insert into public.finance_categories (family_id, id, name, color, icon, kind, "position")
    select p_family_id, c.id, c.name, c.color, c.icon, c.kind, c."position"
    from jsonb_to_recordset(p_finance -> 'categories')
      as c(id text, name text, color text, icon text, kind text, "position" integer);

    insert into public.finance_accounts
      (family_id, id, name, color, icon, opening_cents, "position")
    select p_family_id, a.id, a.name, a.color, a.icon, a.opening_cents, a."position"
    from jsonb_to_recordset(coalesce(p_finance -> 'accounts', '[]'::jsonb))
      as a(id text, name text, color text, icon text, opening_cents bigint, "position" integer);

    -- One statement, so a part may come before its booking (its foreign key is checked at the
    -- end of the statement).
    insert into public.transactions
      (family_id, id, day, amount_cents, payee, description, category_id, note, import_hash,
        account_id, transfer_id, split_of)
    select p_family_id, x.id, x.day, x.amount_cents, x.payee, x.description, x.category_id,
      x.note, x.import_hash, x.account_id, x.transfer_id, x.split_of
    from jsonb_to_recordset(p_finance -> 'transactions')
      as x(id uuid, day date, amount_cents bigint, payee text, description text,
        category_id text, note text, import_hash text, account_id text, transfer_id uuid,
        split_of uuid);

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
