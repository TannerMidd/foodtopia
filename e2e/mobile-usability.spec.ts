import { expect, test, type Page } from "@playwright/test";

const appUrl = process.env.FOODTOPIA_E2E_URL ?? "";

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
}

test("major app routes remain inside narrow mobile viewports", async ({ page }) => {
  const routes = ["/", "/inventory", "/shopping", "/capture", "/recipes", "/household", "/settings"];
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 640 });
    for (const route of routes) {
      await page.goto(`${appUrl}${route}`);
      await expectNoHorizontalOverflow(page);
    }
  }
});

test("inventory rows preserve readable names and mobile-sized actions", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(`${appUrl}/inventory`);

  const row = page.locator('article[id^="lot-"]').first();
  await expect(row).toBeVisible();
  const geometry = await row.evaluate((element) => {
    const heading = element.querySelector("h3")!.getBoundingClientRect();
    const buttons = Array.from(element.querySelectorAll("button")).map((button) => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height, left: rect.left, right: rect.right };
    });
    return { headingWidth: heading.width, buttons };
  });

  expect(geometry.headingWidth).toBeGreaterThanOrEqual(200);
  expect(geometry.buttons).toHaveLength(3);
  for (const button of geometry.buttons) {
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.left).toBeGreaterThanOrEqual(0);
    expect(button.right).toBeLessThanOrEqual(320);
  }
});

test("the item editor stays in the visual viewport and restores focus", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto(`${appUrl}/inventory`);

  const adjust = page.getByRole("button", { name: /^Adjust / }).first();
  await adjust.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: /^Close Adjust / })).toBeFocused();
  await expect
    .poll(() => page.locator("main").evaluate((element) => Boolean(element.closest("[inert]"))))
    .toBe(true);

  const initialBounds = await dialog.boundingBox();
  expect(initialBounds).not.toBeNull();
  expect(initialBounds!.y).toBeGreaterThanOrEqual(0);
  expect(initialBounds!.y + initialBounds!.height).toBeLessThanOrEqual(852);

  await page.getByLabel("Amount tracking").selectOption("known");
  await page.getByLabel("Printed date type").selectOption("best_before");
  await page.setViewportSize({ width: 320, height: 390 });
  await page.getByLabel("Printed date", { exact: true }).focus();

  await expect
    .poll(() =>
      page.getByLabel("Printed date", { exact: true }).evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.visualViewport!.height;
      }),
    )
    .toBe(true);

  const save = page.getByRole("button", { name: "Save change" });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeVisible();
  const saveBounds = await save.boundingBox();
  expect(saveBounds).not.toBeNull();
  expect(saveBounds!.y + saveBounds!.height).toBeLessThanOrEqual(390);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(adjust).toBeFocused();
  await expect
    .poll(() => page.locator("main").evaluate((element) => Boolean(element.closest("[inert]"))))
    .toBe(false);
});

test("manual add opens without a keyboard target and scanner uses one dialog", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(`${appUrl}/inventory`);

  const addManually = page.getByRole("button", { name: "add one by hand" });
  await addManually.click();
  await expect(page.getByRole("heading", { name: "Add one item" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByLabel("Food name")).not.toBeFocused();
  await expect(page.getByRole("button", { name: "Close Add one item" })).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Add item", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close Add one item" })).toBeFocused();

  await page.getByRole("button", { name: "scan a barcode instead" }).click();
  await expect(page.getByRole("heading", { name: "Scan a barcode" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);

  await page.getByRole("button", { name: "Close Scan a barcode" }).click();
  await expect(page.getByRole("heading", { name: "Add one item" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByLabel("Food name")).toHaveValue("");

  await page.getByRole("button", { name: "Close Add one item" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(addManually).toBeFocused();
});
