import { expect, test } from "@playwright/test";

const appUrl = process.env.FOODTOPIA_E2E_URL ?? "";

test("dashboard leads to evidence-based recipe suggestions", async ({ page }) => {
  await page.goto(`${appUrl}/`);
  await expect(page.getByRole("heading", { name: /What.s in the kitchen/ })).toBeVisible();

  await page.getByRole("link", { name: "Recipes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What should we cook?" })).toBeVisible();
  await page.getByLabel("What sounds good?").fill("A vegetarian dinner in 30 minutes");
  await page.getByRole("button", { name: "Find recipes" }).click();

  await expect(page.getByText("Understood request")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Preferences, not allergy protection")).toBeVisible();
  await expect(page.getByText(/Ready|Likely ready|Almost ready/).first()).toBeVisible();
  await expect(page.getByText(/Have it|Amount unknown|Missing|Need more/).first()).toBeVisible();
});

test("manual item entry is optimistic and remains visible", async ({ page }) => {
  await page.goto(`${appUrl}/`);
  await page.getByRole("link", { name: "Add manually" }).click();
  await expect(page.locator("#lot-10000000-0000-4000-8000-000000000001").getByRole("heading", { name: "Tomatoes" })).toBeVisible();
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
  await page.getByRole("button", { name: "Review 1 photo" }).click();
  await expect(page.getByRole("heading", { name: "Review the cloud-processing notice" })).toBeVisible();
  await page.getByRole("button", { name: "I agree & analyze" }).click();

  await expect(page.getByRole("heading", { name: "Review every item" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Nothing reaches inventory until you confirm below.")).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByText("Photo review waiting").first()).toBeVisible();
  await page.getByText("Photo review waiting").first().click();
  await expect(page.getByRole("heading", { name: "Review every item" })).toBeVisible();
  await page.getByRole("button", { name: "Add a missed food" }).click();
  const missedName = `Cilantro ${Date.now()}`;
  await page.getByLabel("Food name").last().fill(missedName);
  await page.getByRole("button", { name: /Confirm \d+ items?/ }).click();

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
  await page.getByRole("button", { name: "Review 1 photo" }).click();
  await page.getByRole("button", { name: "I agree & analyze" }).click();

  await expect(page.getByText("Private upload ready to resume")).toBeVisible();
  await page.getByRole("button", { name: "Retry this analysis" }).click();
  await expect(page.getByRole("heading", { name: "Review every item" })).toBeVisible({ timeout: 15_000 });
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
  await expect(
    page.getByRole("heading", { name: "Spinach Tomato Scrambled Eggs" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start cooking" }).click();

  await expect(page.getByText("Cooking now")).toBeVisible();
  await page.getByRole("button", { name: "Finish & update ingredients" }).click();
  const eggChoice = page.getByRole("radiogroup", {
    name: "Amount of eggs used from Eggs",
  }).first();
  await eggChoice.getByRole("radio", { name: "Used up" }).click();
  await page.getByRole("button", { name: "Save kitchen" }).click();

  await expect(page.getByRole("heading", { name: "Kitchen updated" })).toBeVisible();
  await page.getByRole("button", { name: "Undo inventory changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Kitchen changes undone" }),
  ).toBeVisible();
});
