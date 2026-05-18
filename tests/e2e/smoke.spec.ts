import { test, expect } from "@playwright/test";

/**
 * Smoke test — verifies the unauthenticated landing page renders.
 * Requires a running dev server (Playwright's webServer config will start one).
 */
test("home page renders and links to login and signup", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /VBS Check-In/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Sign in/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Register a family/i })).toBeVisible();
});

test("login page renders the email form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /send sign-in link/i })).toBeVisible();
});

test("signup page renders the registration form (requires seed: stops)", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: /Register your family/i })).toBeVisible();
});
