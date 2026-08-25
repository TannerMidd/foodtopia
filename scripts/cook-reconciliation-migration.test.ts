import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20260826000002_validate_cook_reconciliation_ingredients.sql",
  ),
  "utf8",
);

describe("cook reconciliation ingredient validation migration", () => {
  it("validates snapshot membership and effective lot concept before insert", () => {
    expect(sql).toContain("before insert on public.cook_reconciliations");
    expect(sql).toContain("session.recipe_snapshot -> 'ingredients'");
    expect(sql).toContain("ingredient ->> 'id' = new.ingredient_id");
    expect(sql).toContain("lot.food_concept_id");
    expect(sql).toContain("lot_concept_id <> effective_concept_id");
    expect(sql).toContain("errcode = '22023'");
    expect(sql).not.toContain("limit 1");
  });

  it("rejects malformed and duplicate snapshot ingredient IDs before enabling the trigger", () => {
    expect(sql).toContain("jsonb_typeof(p_snapshot -> 'ingredients') <> 'array'");
    expect(sql).toContain("jsonb_typeof(ingredient) <> 'object'");
    expect(sql).toContain("jsonb_typeof(ingredient -> 'id') <> 'string'");
    expect(sql).toContain("ingredient_id = any(seen_ids)");
    expect(sql).toContain("cook_sessions_snapshot_ingredients_valid");
    expect(sql).toContain("existing recipe snapshot has malformed or duplicate ingredient IDs");
    expect(sql).toContain("historical rows do not match their recipe snapshots");
  });

  it("removes direct authenticated cook-session mutation authority", () => {
    expect(sql).toContain(
      "revoke insert, update, delete on public.cook_sessions from authenticated",
    );
  });
});
