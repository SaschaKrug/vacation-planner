-- Account balances at a day: the sum of each account's transactions up to and including it
-- (parts of split bookings don't count, their booking does), like finance_account_totals.

create or replace function public.finance_account_totals_until(p_family_id text, p_day date)
returns table (account_id text, total_cents bigint)
language sql
stable
set search_path = public
as $$
  select t.account_id, sum(t.amount_cents)::bigint
  from public.transactions t
  where t.family_id = p_family_id and t.account_id is not null and t.split_of is null
    and t.day <= p_day
  group by t.account_id;
$$;

revoke execute on function public.finance_account_totals_until(text, date)
  from public, anon, authenticated;
grant execute on function public.finance_account_totals_until(text, date) to service_role;
