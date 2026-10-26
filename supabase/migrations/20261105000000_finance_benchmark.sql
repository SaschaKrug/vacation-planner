-- A statistic average per family to measure its months against in the overview (e.g. a
-- statistics office's household spending): {label, income, expense, categories: [{categoryId,
-- lowCents, highCents}]}, each amount a range per month ({lowCents, highCents}); null when not
-- set.

alter table public.family_settings
  add column if not exists benchmark jsonb;
