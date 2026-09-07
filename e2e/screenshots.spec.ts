import { test } from "@playwright/test";
import { completeOnboarding, signUpAndVerify, uniqueEmail } from "./helpers";

// Visual capture pass. Not assertions — this exists so the UI can actually be looked at
// after a design change, rather than trusted because the HTML parsed.
// Run with:  npx playwright test screenshots --project=chromium

test.describe("Visual capture", () => {
  test("public and auth surfaces", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto("/");
    await page.waitForTimeout(600);
    await page.screenshot({ path: "screenshots/01-landing.png", fullPage: true });

    await page.goto("/signup");
    await page.waitForTimeout(400);
    await page.screenshot({ path: "screenshots/02-signup.png" });

    await page.goto("/login");
    await page.waitForTimeout(400);
    await page.screenshot({ path: "screenshots/03-login.png" });

    // Mobile: the branded panel must collapse rather than push the form off-screen.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    await page.waitForTimeout(400);
    await page.screenshot({ path: "screenshots/04-login-mobile.png" });
  });

  test("authenticated surfaces", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const email = uniqueEmail("shot");

    await signUpAndVerify(page, email);
    await page.waitForTimeout(600);
    await page.screenshot({ path: "screenshots/05-dashboard-new.png", fullPage: true });

    await page.goto("/onboarding");
    await page.waitForTimeout(600);
    await page.screenshot({ path: "screenshots/06-onboarding.png", fullPage: true });

    await completeOnboarding(page);

    await page.goto("/dashboard");
    await page.waitForTimeout(600);
    await page.screenshot({ path: "screenshots/07-dashboard-onboarded.png", fullPage: true });

    await page.goto("/dashboard/assessment");
    await page.getByRole("button", { name: /Run my assessment/ }).click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: "screenshots/08-matches.png", fullPage: true });

    await page.goto("/dashboard/universities");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "screenshots/09-universities.png", fullPage: true });

    await page.goto("/dashboard/vault");
    await page.waitForTimeout(1200);
    await page.screenshot({ path: "screenshots/10-vault.png", fullPage: true });
  });
});
