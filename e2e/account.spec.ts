import { expect, test } from "@playwright/test";
import { PASSWORD, completeOnboarding, signUpAndVerify, uniqueEmail } from "./helpers";

// The account surfaces a student reaches on their own: the notification centre in the
// shell, and the settings page where they change a password, cut off a device, take their
// data, or leave.

test.describe("Account", () => {
  test("the shell carries a working notification centre", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    await signUpAndVerify(page, uniqueEmail("notif"));
    await page.goto("/dashboard");

    // Sign-up raises WELCOME, so a brand-new account already has something to show.
    const bell = page.getByRole("button", { name: /Notifications/ });
    await expect(bell).toBeVisible({ timeout: 30_000 });
    await bell.click();

    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();

    const markAll = page.getByRole("button", { name: "Mark all read" });
    if (await markAll.isVisible().catch(() => false)) {
      await markAll.click();
      // The badge is the whole point of the unread count; it must actually clear.
      await expect(page.getByRole("button", { name: /\d+ unread/ })).toHaveCount(0);
    }

    // Escape closes it — a dropdown that only the trigger can dismiss gets reported as
    // "stuck".
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Notifications" })).toHaveCount(0);
  });

  test("settings lets a student manage their password, devices and data", async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    await signUpAndVerify(page, uniqueEmail("settings"));
    await completeOnboarding(page);

    await page.goto("/dashboard/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({
      timeout: 30_000,
    });

    // --- sessions ---------------------------------------------------------
    await expect(page.getByRole("heading", { name: /Where you're signed in/ })).toBeVisible();
    await expect(page.getByText("This device")).toBeVisible({ timeout: 30_000 });

    // --- password ---------------------------------------------------------
    // The wrong current password must be refused by the server, not just discouraged.
    await page.getByLabel("Current password").fill("definitely-not-my-password");
    await page.getByLabel("New password").fill("AnotherRealPassphrase42!");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText(/not your current password/i)).toBeVisible({ timeout: 30_000 });

    await page.getByLabel("Current password").fill(PASSWORD);
    await page.getByLabel("New password").fill("AnotherRealPassphrase42!");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText(/Password changed/i)).toBeVisible({ timeout: 30_000 });

    // --- deletion ---------------------------------------------------------
    // What is retained has to be visible before the student agrees, not after.
    await expect(page.getByText(/What we have to keep/i)).toBeVisible();
    await expect(page.getByText(/legally required/i)).toBeVisible();

    await page.getByRole("button", { name: "Delete my account" }).click();
    await page.getByRole("button", { name: "Yes, delete my account" }).click();
    await expect(page.getByText(/scheduled for deletion/i)).toBeVisible({ timeout: 30_000 });

    // And it must be reversible for as long as the grace period is advertised.
    await page.getByRole("button", { name: "Keep my account" }).click();
    await expect(page.getByRole("button", { name: "Delete my account" })).toBeVisible({
      timeout: 30_000,
    });
  });
});
