import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve("supabase/migrations/20260826000004_recipe_proposals.sql"),
  "utf8",
);

describe("recipe proposal migration", () => {
  it("keeps proposal DML private and decisions atomic and tenant-derived", () => {
    expect(migration).toContain("revoke all on public.recipe_proposals from anon, authenticated");
    expect(migration).toContain("security definer");
    expect(migration).toContain("actor_household_id uuid := private.current_household_id()");
    expect(migration).toContain("p_expected_version");
    expect(migration).toContain("for update");
    expect(migration).toContain("status = 'approved'");
    expect(migration).toContain("status = 'denied', recipe_payload = null");
    expect(migration).toContain("rights_status, created_by");
    expect(migration).toContain("'draft', actor_id");
  });

  it("adds a separate generation allowance and never stores raw prompts", () => {
    expect(migration).toContain("'recipe_generate'");
    expect(migration).not.toMatch(/prompt_text|raw_prompt|inventory_label/i);
    expect(migration).toContain("content_hash text");
    expect(migration).not.toContain("content_hash text generated always");
    expect(migration).toContain("content_hash = null");
    expect(migration).toContain("constraint recipe_proposals_idempotency unique");
    expect(migration).toContain("request_fingerprint text not null");
    expect(migration).toContain("expires_at timestamptz not null");
    expect(migration).toContain("status = 'expired', recipe_payload = null");
  });

  it("blocks disabled-token access through the shared household boundary", () => {
    expect(migration).toContain("create or replace function private.current_household_id()");
    expect(migration).toContain("join public.profiles as p on p.id = hm.user_id");
    expect(migration).toContain("p.status = 'enabled'");
    expect(migration).toContain("drop policy recipes_select_household");
    expect(migration).toContain("drop policy recipe_ingredients_select_household");
    expect(migration.match(/p\.status = 'enabled'/g)?.length).toBeGreaterThanOrEqual(8);
  });
});
