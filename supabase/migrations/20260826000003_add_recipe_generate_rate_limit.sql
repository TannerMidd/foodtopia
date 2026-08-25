-- Generation is materially more expensive than deterministic suggestion ranking.
-- Commit this enum addition before the next migration references it.
alter type public.api_rate_limit_action add value if not exists 'recipe_generate' after 'recipe_suggest';
