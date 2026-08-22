import { expect, test } from "@playwright/test";

const appUrl = process.env.FOODTOPIA_E2E_URL ?? "";

test("dashboard leads to evidence-based recipe suggestions", async ({ page }) => {
  await page.goto(`${appUrl}/`);
  await expect(page.getByRole("heading", { name: /things want using this week/ })).toBeVisible();

  await page.getByRole("link", { name: "cook", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What sounds good?" })).toBeVisible();
  await page.getByLabel("What sounds good?").fill("A vegetarian dinner in 30 minutes");
  await page.getByRole("button", { name: "Find recipes" }).click();

  await expect(page.getByText("understood", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/not allergy controls/)).toBeVisible();
  await expect(page.getByText(/^(ready|likely ready|almost ready)$/).first()).toBeVisible();
  await expect(page.getByText(/Have it|Amount unknown|Missing|Need more/).first()).toBeVisible();
});

test("manual item entry is optimistic and remains visible", async ({ page }) => {
  await page.goto(`${appUrl}/inventory`);
  await expect(page.locator("#lot-10000000-0000-4000-8000-000000000001").getByRole("heading", { name: "Tomatoes" })).toBeVisible();

  await page.getByRole("button", { name: "add one by hand" }).click();
  await expect(page.getByRole("heading", { name: "Add one item" })).toBeVisible();

  const itemName = `Miso ${Date.now()}`;
  await page.getByLabel("Food name").fill(itemName);
  await page.getByLabel("Location", { exact: true }).selectOption("pantry");
  await page.getByRole("button", { name: "Add item", exact: true }).click();

  await expect(page.getByText(itemName, { exact: true })).toBeVisible();
  await expect(page.getByText(/added/).last()).toBeVisible();
});

test("photo candidates are reviewed and a missed food can be added before confirm", async ({ page }) => {
  await page.goto(`${appUrl}/capture`);
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="#d95c45"/><circle cx="80" cy="90" r="50" fill="#f5d668"/><circle cx="165" cy="90" r="50" fill="#4f8b62"/></svg>',
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "tomato-eggs.svg",
    mimeType: "image/svg+xml",
    buffer: svg,
  });
  await expect(page.getByAltText("Batch photo 1")).toBeVisible();
  await page.getByRole("button", { name: "Look for food" }).click();
  await expect(page.getByRole("heading", { name: "Review the cloud-processing notice" })).toBeVisible();
  await page.getByRole("button", { name: "I agree & analyze" }).click();

  await expect(page.getByRole("heading", { name: /Keep what.s right\./ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Nothing is saved until you say so.")).toBeVisible();
  await page.getByRole("link", { name: "today", exact: true }).click();
  await expect(page.getByText("Photo review waiting").first()).toBeVisible();
  await page.getByText("Photo review waiting").first().click();
  await expect(page.getByRole("heading", { name: /Keep what.s right\./ })).toBeVisible();
  await page.getByRole("button", { name: "Something the photo missed…" }).click();
  const missedName = `Cilantro ${Date.now()}`;
  await page.getByLabel("Food name").last().fill(missedName);
  await page.getByRole("button", { name: /^Save \w+ items?$/ }).click();

  await expect(page).toHaveURL(/\/inventory/);
  await expect(page.getByText(missedName, { exact: true })).toBeVisible();
});

test("a queue-delivery failure resumes the same uploaded analysis", async ({ page }) => {
  let createRequests = 0;
  let completeRequests = 0;
  await page.route("**/api/v1/analyses", async (route) => {
    if (route.request().method() === "POST") createRequests += 1;
    await route.continue();
  });
  await page.route("**/api/v1/analyses/*/complete", async (route) => {
    completeRequests += 1;
    if (completeRequests === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "ANALYSIS_QUEUE_FAILED",
          message: "The scan was uploaded but could not be queued. Retry to continue.",
          retryable: true,
          correlationId: crypto.randomUUID(),
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto(`${appUrl}/capture`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "retry-batch.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="#4f8b62"/></svg>',
    ),
  });
  await page.getByRole("button", { name: "Look for food" }).click();
  await page.getByRole("button", { name: "I agree & analyze" }).click();

  await expect(page.getByText("Private upload ready to resume")).toBeVisible();
  await page.getByRole("button", { name: "Retry this analysis" }).click();
  await expect(page.getByRole("heading", { name: /Keep what.s right\./ })).toBeVisible({ timeout: 15_000 });
  expect(createRequests).toBe(1);
  expect(completeRequests).toBe(2);
});

test("cooking reconciliation can be undone through inventory events", async ({ page }) => {
  await page.goto(`${appUrl}/recipes`);
  await page.getByLabel("What sounds good?").fill(
    "A vegetarian breakfast under 20 minutes",
  );
  await page.getByRole("button", { name: "Find recipes" }).click();

  const recipe = page.getByRole("button", {
    name: "Open Spinach Tomato Scrambled Eggs",
  });
  await expect(recipe).toBeVisible({ timeout: 15_000 });
  await recipe.click();
  await expect(page.getByText("spinach tomato scrambled eggs", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Cook this" }).click();

  await expect(page.getByText(/cooking · step/)).toBeVisible();
  await page.getByRole("button", { name: "Done cooking" }).click();
  const eggChoice = page.getByRole("radiogroup", {
    name: "Amount of eggs used from Eggs",
  }).first();
  await eggChoice.getByRole("radio", { name: "used up" }).click();
  await page.getByRole("button", { name: "Update the kitchen" }).click();

  await expect(page.getByRole("heading", { name: "Kitchen updated" })).toBeVisible();
  await page.getByRole("button", { name: "undo inventory changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Kitchen changes undone" }),
  ).toBeVisible();
});
