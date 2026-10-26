-- A statistic average per family to compare its months with in the overview (e.g. a statistics
-- office's household spending): {label, incomeCents, expenseCents, categories: [{categoryId,
-- cents}]}, all per month; null when not set.

alter table public.family_settings
  add column if not exists benchmark jsonb;
