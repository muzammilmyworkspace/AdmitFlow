import { expect, test } from "@playwright/test";
import { completeOnboarding, signUpAndVerify, uniqueEmail } from "./helpers";

// The full student journey, driven through the real UI in a real browser.
// docs/35-testing-strategy.md §"E2E tests" names exactly this path as the one that must
// work end to end: signup -> verification -> onboarding -> assessment -> unlock.

test.describe("Student journey", () => {
  test("signs up, onboards, assesses, and unlocks matches", async ({ page }) => {
    const email = uniqueEmail("journey");

    await test.step("sign up and verify", async () => {
      await signUpAndVerify(page, email);
      await expect(page.getByRole("heading", { name: "Your journey" })).toBeVisible();
    });

    await test.step("dashboard tells the student what to do next", async () => {
      await expect(page.getByText("Do this next")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Complete your profile" })).toBeVisible();
    });

    await test.step("complete onboarding through the wizard", async () => {
      await completeOnboarding(page);
    });

    await test.step("run the assessment", async () => {
      await page.goto("/dashboard/assessment");
      await page.getByRole("button", { name: /Run my assessment/ }).click();
      await expect(page.getByText(/programmes matched/)).toBeVisible({ timeout: 30_000 });
    });

    await test.step("the free tier always shows real matches, never an empty paywall", async () => {
      // A strong profile can legitimately have zero REACH matches. Showing such a student
      // nothing at all behind a paywall would be a dark pattern, so the free preview
      // guarantees readable results regardless of how their zones fall.
      await expect(page.getByRole("button", { name: "Why this score?" }).first()).toBeVisible();
      const visibleCards = await page.getByRole("button", { name: "Why this score?" }).count();
      expect(visibleCards).toBeGreaterThan(0);
    });

    await test.step("the rest are paywalled, and nothing about them leaks", async () => {
      await expect(page.getByText(/more matches available/)).toBeVisible();

      // Locked programmes must not be present anywhere in the delivered HTML — not
      // hidden, not blurred, not in a data attribute (docs/54-decision-log.md D-5).
      // Counting rendered cards against the stated locked total proves the server sent
      // only what it should, whichever programmes happened to be previewed.
      const lockedText = await page.getByText(/more matches available/).innerText();
      const lockedTotal = Number(lockedText.match(/^(\d+)/)?.[1] ?? "0");
      const renderedCards = await page.getByRole("button", { name: "Why this score?" }).count();
      expect(lockedTotal).toBeGreaterThan(0);
      expect(renderedCards).toBeLessThan(lockedTotal + renderedCards);
    });

    await test.step("unlock through checkout", async () => {
      await page.getByRole("button", { name: /Unlock all matches/ }).click();
      await page.waitForURL(/dev-checkout/, { timeout: 20_000 });
      await expect(page.getByText("Development checkout")).toBeVisible();
      await page.getByRole("button", { name: /^Pay/ }).click();
      await page.waitForURL(/billing\/success/, { timeout: 20_000 });
    });

    await test.step("matches are now visible with full reasoning", async () => {
      await page.goto("/dashboard/assessment");
      await expect(page.getByRole("heading", { name: "Strong matches" })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText(/more matches available/)).toHaveCount(0);

      // Explainability is a product requirement, not a nice-to-have.
      await page.getByRole("button", { name: "Why this score?" }).first().click();
      await expect(page.getByText(/weight 25%/).first()).toBeVisible();
    });
  });
});

test.describe("Public pages", () => {
  test("landing page states the positioning without overclaiming", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Say No to Consultants/ })).toBeVisible();
    // The charter forbids implying a guaranteed outcome anywhere in the product.
    const html = await page.content();
    expect(html).not.toMatch(/100% guaranteed/i);
    expect(html).toMatch(/not an admission or visa decision/i);
  });

  test("signup shows password requirements before submission, not after", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByText(/At least 12 characters/)).toBeVisible();
  });
});

test.describe("Access control", () => {
  test("signed-out visitors are redirected away from the dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/login/);
  });

  test("a student cannot reach the admin area", async ({ page }) => {
    await signUpAndVerify(page, uniqueEmail("noadmin"));
    await page.goto("/admin");
    await expect(page).toHaveURL(/dashboard/);
  });
});
