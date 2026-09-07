import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

export const PASSWORD = "CorrectHorse42!";
const DEV_LOG = process.env.DEV_LOG ?? "/tmp/dev.log";

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
}

/**
 * Pulls the most recent verification link out of the dev mailer's log output.
 *
 * The dev mailer writes auth emails to the server log rather than sending them (no
 * provider is configured), so this is how a browser test completes verification the same
 * way a real user would — by following the link they were sent.
 */
export function latestVerificationToken(): string {
  let raw = "";
  try {
    raw = readFileSync(DEV_LOG, "utf8");
  } catch {
    // Git Bash and Node disagree about /tmp on Windows; fall back to asking the shell.
    raw = execSync(`cat ${DEV_LOG}`, { encoding: "utf8", shell: "bash" });
  }
  const matches = [...raw.matchAll(/verify-email\?token=([A-Za-z0-9_-]+)/g)];
  const last = matches[matches.length - 1];
  if (!last) throw new Error("No verification token found in the dev server log.");
  return last[1]!;
}

/** Signs up through the real form, then verifies via the emailed link. */
export async function signUpAndVerify(page: Page, email: string): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("First name").fill("Amina");
  await page.getByLabel("Last name").fill("Yusuf");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await page.waitForURL(/verify-email/);

  const token = latestVerificationToken();
  await page.goto(`/verify-email?token=${token}`);
  await page.waitForURL(/dashboard/, { timeout: 20_000 });
}

/**
 * Opens an onboarding step by its title.
 *
 * Scoped to the step navigation and matched on the title alone, because the button's
 * accessible name also contains its position indicator — which changes from a number to a
 * tick once the step is complete. Matching the whole string made these selectors break
 * whenever the nav's visual treatment changed, which is not what they exist to detect.
 */
async function gotoStep(page: Page, title: string): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Onboarding steps" });
  await nav.getByRole("button").filter({ hasText: title }).click();
}

/** Completes every onboarding step through the wizard UI. */
export async function completeOnboarding(page: Page): Promise<void> {
  await page.goto("/onboarding");
  const save = () => page.getByRole("button", { name: "Save", exact: true }).click();

  await gotoStep(page, "About you");
  await page.getByLabel("First name").fill("Amina");
  await page.getByLabel("Last name").fill("Yusuf");
  await page.getByLabel("Date of birth").fill("2002-01-01");
  await save();
  await page.waitForTimeout(400);

  await gotoStep(page, "Education");
  await page.getByLabel("Institution").fill("Test University");
  await page.getByLabel("Country").selectOption({ label: "United Kingdom" });
  await page.getByLabel("Field of study").fill("Computer Science");
  await page.getByLabel("Your grade").fill("3.6");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForTimeout(500);

  await gotoStep(page, "Where you want to study");
  await page.getByLabel("United Kingdom", { exact: true }).check();
  await page.getByLabel("Target intake").fill("Fall 2027");
  await save();
  await page.waitForTimeout(500);

  await gotoStep(page, "Budget");
  await page.getByLabel("Maximum per year").fill("40000");
  await page.getByLabel("Currency").selectOption("GBP");
  await save();
  await page.waitForTimeout(500);

  await gotoStep(page, "English proficiency");
  await page.getByRole("button", { name: "Add a test result" }).click();
  await page.getByLabel("Overall score").fill("7.5");
  await page.getByLabel("Test date").fill("2026-03-01");
  await page.getByRole("button", { name: "Add result" }).click();
  await page.waitForTimeout(500);

  await gotoStep(page, "Preferences");
  await page.getByLabel("Study mode").selectOption("ON_CAMPUS");
  await save();
  await page.waitForTimeout(500);

  const finish = page.getByRole("button", { name: /Finish and see my matches/ });
  await expect(finish).toBeEnabled({ timeout: 10_000 });
  await finish.click();
  await page.waitForURL(/dashboard/, { timeout: 20_000 });
}
