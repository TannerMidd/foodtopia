import { expect, test } from "@playwright/test";

const appUrl = process.env.FOODTOPIA_E2E_URL ?? "";

test("static offline fallback reads Dexie and queues an edit", async ({ context, page }) => {
  await page.goto(`${appUrl}/~offline`);
  await expect(page.getByText("Device-only offline inventory")).toBeVisible();
  await expect(page.locator("#lot-10000000-0000-4000-8000-000000000001").getByRole("heading", { name: "Tomatoes" })).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText(/Offline — inventory edits will sync/)).toBeVisible();
  await page.getByRole("button", { name: "Add food manually" }).click();
  const itemName = `Offline oats ${Date.now()}`;
  await page.getByLabel("Food name").fill(itemName);
  await page.getByRole("button", { name: "Add item", exact: true }).click();

  await expect(page.getByText(itemName, { exact: true })).toBeVisible();
  await expect(page.getByText(/1 pending/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/1 pending/)).toBeHidden({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByText(itemName, { exact: true })).toBeVisible();
});

test("a stale inventory command surfaces a resolvable 409", async ({ page }) => {
  await page.goto(`${appUrl}/inventory`);
  const inventoryRow = page.locator("article").first();
  await expect(inventoryRow).toBeVisible();
  await page.route("**/api/v1/inventory/commands", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        code: "STALE_VERSION",
        message: "This item changed in your household. Review the latest value before reapplying.",
        retryable: false,
        correlationId: crypto.randomUUID(),
      }),
    });
  });

  await inventoryRow.getByRole("button", { name: "Used up" }).click();
  await expect(page.getByText("Household update collided")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/paused the ordered outbox at this 409/)).toBeVisible();
  await page.getByRole("button", { name: "Use latest" }).click();
  await expect(page.getByText("Household update collided")).toBeHidden();
});

test("a permanent queued-command failure pauses and can be discarded", async ({ page }) => {
  await page.goto(`${appUrl}/inventory`);
  const inventoryRow = page.locator("article").first();
  await expect(inventoryRow).toBeVisible();
  await page.route("**/api/v1/inventory/commands", async (route) => {
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        code: "VALIDATION_ERROR",
        message: "This change is no longer valid.",
        retryable: false,
        correlationId: crypto.randomUUID(),
      }),
    });
  });

  await inventoryRow.getByRole("button", { name: "Used up" }).click();
  await expect(page.getByText("Queued change was rejected")).toBeVisible();
  await page.getByRole("button", { name: "Discard change" }).click();
  await expect(page.getByText("Queued change was rejected")).toBeHidden();
});

test("an authenticated 403 immediately evicts the prior household offline store", async ({ page }) => {
  await page.goto(`${appUrl}/inventory`);
  await expect(
    page
      .locator("#lot-10000000-0000-4000-8000-000000000001")
      .getByRole("heading", { name: "Tomatoes" }),
  ).toBeVisible();

  await page.route("**/api/v1/households/current", async (route) => {
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        code: "HOUSEHOLD_ACCESS_REVOKED",
        message: "Household access was revoked.",
        retryable: false,
        correlationId: crypto.randomUUID(),
      }),
    });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));

  await expect(page.getByText("Sync paused: Household access was revoked.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tomatoes" })).toBeHidden();

  const counts = await page.evaluate(async () =>
    new Promise<Record<string, number>>((resolve, reject) => {
      const request = indexedDB.open("foodtopia-offline-v1");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const storeNames = ["lots", "outbox", "snapshots", "meta"].filter(
          (name) => database.objectStoreNames.contains(name),
        );
        if (!storeNames.length) {
          database.close();
          resolve({});
          return;
        }
        const transaction = database.transaction(storeNames, "readonly");
        const result: Record<string, number> = {};
        for (const name of storeNames) {
          const count = transaction.objectStore(name).count();
          count.onsuccess = () => {
            result[name] = count.result;
          };
          count.onerror = () => reject(count.error);
        }
        transaction.oncomplete = () => {
          database.close();
          resolve(result);
        };
        transaction.onerror = () => reject(transaction.error);
      };
    }),
  );
  expect(counts).toEqual({ lots: 0, outbox: 0, snapshots: 0, meta: 0 });
});

test("logout clears Dexie household rows and Foodtopia caches", async ({ page }) => {
  await page.goto(`${appUrl}/settings`);
  await page.evaluate(async () => {
    const cache = await caches.open("foodtopia-test-sensitive");
    await cache.put("/test-household-shell", new Response("test"));
    localStorage.setItem("foodtopia:preferences", "prior-household");
    localStorage.setItem("foodtopia:vision-consent:vision-v2", "prior-user");
    sessionStorage.setItem("foodtopia:recipe:last", "prior-household-evidence");
  });

  await page.getByRole("button", { name: "Sign out & clear this device" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  const remaining = await page.evaluate(async () => {
    const cacheKeys = await caches.keys();
    const lotCount = await new Promise<number>((resolve, reject) => {
      const request = indexedDB.open("foodtopia-offline-v1");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("lots")) {
          database.close();
          resolve(0);
          return;
        }
        const transaction = database.transaction("lots", "readonly");
        const count = transaction.objectStore("lots").count();
        count.onsuccess = () => {
          database.close();
          resolve(count.result);
        };
        count.onerror = () => reject(count.error);
      };
    });
    return {
      lotCount,
      foodtopiaCaches: cacheKeys.filter((key) => key.startsWith("foodtopia-")),
      localKeys: Object.keys(localStorage).filter((key) => key.startsWith("foodtopia:")),
      sessionKeys: Object.keys(sessionStorage).filter((key) => key.startsWith("foodtopia:")),
    };
  });
  expect(remaining.lotCount).toBe(0);
  expect(remaining.foodtopiaCaches).toEqual([]);
  expect(remaining.localKeys).toEqual([]);
  expect(remaining.sessionKeys).toEqual([]);
});
