import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20260826000001_seeded_recipes_and_flags.sql",
  ),
  "utf8",
);

describe("seeded recipe migration contract", () => {
  it("remediates legacy household rights before replacing the old constraint", () => {
    const constraintReplacement = migration.indexOf(
      "alter table public.recipes drop constraint recipes_review_shape",
    );

    expect(migration.indexOf("Public recipe rights metadata is invalid")).toBeGreaterThan(-1);
    expect(migration.indexOf("where visibility = 'household'\n   and rights_status = 'draft'"))
      .toBeLessThan(constraintReplacement);
    expect(migration.indexOf("set rights_status = 'draft'"))
      .toBeLessThan(constraintReplacement);
    expect(migration).toContain("rights_reviewer = btrim(rights_reviewer)");
    expect(migration).toContain("char_length(btrim(rights_reviewer)) between 1 and 160");
  });

  it("keeps recipe flags private to an enabled reporter", () => {
    expect(migration).toContain("flagged_by = (select auth.uid())");
    expect(migration.match(/p.status = 'enabled'/g)).toHaveLength(2);
  });
});
