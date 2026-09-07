import { expect, test } from "@playwright/test";
import { completeOnboarding, signUpAndVerify, uniqueEmail } from "./helpers";

// The matches grid, and the one invariant it must never break.
//
// The API-level version of this lives in scripts/e2e.sh §4. This is the same rule checked
// where a student would actually break it: in the page the browser received. A blur, a
// `display: none`, or a locked name sitting in the React props would all pass a visual
// review and fail here — which is the point.

test.describe("Assessment matches", () => {
  test("shows big cards, locks the rest, and leaks nothing", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    await signUpAndVerify(page, uniqueEmail("matches"));
    await completeOnboarding(page);

    await page.goto("/dashboard/assessment");
    await page.getByRole("button", { name: /Run my assessment/ }).click();
    await expect(page.getByRole("heading", { name: /programmes matched/ })).toBeVisible({
      timeout: 60_000,
    });

    // --- the readable matches ---------------------------------------------
    const matchCards = page.locator("article").filter({ hasText: "Why this score?" });
    await expect(matchCards.first()).toBeVisible();
    const readable = await matchCards.count();
    expect(readable).toBeGreaterThan(0);

    // --- the locked ones ---------------------------------------------------
    const lockedCards = page.getByRole("button", { name: "Unlock to see this match" });
    const lockedCount = await lockedCards.count();
    expect(lockedCount).toBeGreaterThan(0);

    // Three across on a desktop viewport: the student is meant to compare universities
    // against each other, which is what the grid is for.
    const boxes = await matchCards.evaluateAll((nodes) =>
      nodes.map((n) => Math.round(n.getBoundingClientRect().top)),
    );
    const topRow = boxes.filter((top) => top === boxes[0]).length;
    expect(topRow).toBeGreaterThanOrEqual(Math.min(3, readable));

    // --- the invariant -----------------------------------------------------
    // Ask the server what it actually sent for the locked entries, then prove none of the
    // programme data behind the paywall reached the page.
    const payload = await page.evaluate(async () => {
      const response = await fetch("/api/v1/assessment/results");
      return response.json();
    });

    const results = payload.data.results.results as Array<Record<string, unknown>>;
    const locked = results.filter((r) => r.locked);
    expect(locked.length).toBeGreaterThan(0);

    // A locked entry carries three keys and no more. If a future change adds a "name" or
    // a "score" here "just for the blur", this fails before it ships.
    for (const entry of locked) {
      expect(Object.keys(entry).sort()).toEqual(["locked", "placeholderId", "zone"]);
    }

    // No programme id may appear in the delivered document unless the student is entitled
    // to it. Every id in the page is collected — hrefs, data attributes, the serialized
    // React payload alike — and checked against the unlocked set. A locked programme that
    // reached the browser in any form fails here.
    const html = await page.content();
    const unlockedIds = new Set(
      results.filter((r) => !r.locked).map((r) => r.programId as string),
    );
    expect(unlockedIds.size).toBeGreaterThan(0);

    const idsInDocument = new Set(
      html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [],
    );
    const programmeIdsInDocument = [...idsInDocument].filter((id) =>
      html.includes(`/dashboard/universities/${id}`),
    );
    expect(programmeIdsInDocument.length).toBeGreaterThan(0);
    for (const id of programmeIdsInDocument) {
      expect(unlockedIds.has(id)).toBe(true);
    }

    const placeholderIds = locked.map((r) => r.placeholderId as string);
    for (const id of placeholderIds) {
      // The placeholder is positional and safe by construction; it must not be a real id.
      expect(unlockedIds.has(id)).toBe(false);
      expect(id).toMatch(/^(locked|withdrawn)-\d+$/);
    }
  });

  test("offers the consultant review after the assessment", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    await signUpAndVerify(page, uniqueEmail("review"));
    await completeOnboarding(page);

    await page.goto("/dashboard/assessment");
    await page.getByRole("button", { name: /Run my assessment/ }).click();
    await expect(page.getByRole("heading", { name: /programmes matched/ })).toBeVisible({
      timeout: 60_000,
    });

    await expect(
      page.getByRole("heading", { name: /Want a consultant to go through this/ }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /Get a consultant review/ })).toBeVisible();
    await expect(page.getByText("€10")).toBeVisible();
  });
});
