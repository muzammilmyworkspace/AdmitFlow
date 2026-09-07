import { expect, test } from "@playwright/test";

// Browser extensions decorate the document before React hydrates, and React reports the
// difference as a hydration mismatch even though the app produced none of it. Grammarly
// is the common case: it stamps data-gr-ext-installed onto <body>.
//
// This reproduces that by injecting the same attributes as early as a real extension
// would, then asserting React stays quiet — so the suppressHydrationWarning placement in
// layout.tsx is verified rather than assumed. It also guards the subtle part: the flag
// does not cascade, so <html> and <body> each need their own.

const EXTENSION_ATTRS = `
  const stamp = () => {
    if (document.documentElement) {
      document.documentElement.setAttribute("data-lt-installed", "true");
    }
    if (document.body) {
      document.body.setAttribute("data-new-gr-c-s-check-loaded", "14.1326.0");
      document.body.setAttribute("data-gr-ext-installed", "");
    }
  };
  stamp();
  new MutationObserver(stamp).observe(document, { childList: true, subtree: true });
`;

const PAGES = ["/", "/login", "/signup"];

for (const path of PAGES) {
  test(`no hydration warning on ${path} with an extension present`, async ({ page }) => {
    const hydrationErrors: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (/hydrat/i.test(text)) hydrationErrors.push(text);
    });

    await page.addInitScript(EXTENSION_ATTRS);
    await page.goto(path);
    // Hydration warnings surface shortly after the client bundle runs.
    await page.waitForTimeout(2500);

    // Confirm the simulation actually did something — otherwise this test could pass
    // simply because the attributes were never injected.
    await expect(page.locator("body[data-gr-ext-installed]")).toHaveCount(1);

    expect(hydrationErrors).toEqual([]);
  });
}
