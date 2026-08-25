-- Initial catalog recipes are public but are not represented as editorially reviewed.
-- Keep this enum addition in its own migration: PostgreSQL requires a commit before
-- the new enum value can be used by constraints or policies.
alter type public.recipe_review_status add value if not exists 'seeded' after 'draft';
