/**
 * Dispatch UI authentication via Cognito login flow.
 *
 * The dispatch-new frontend uses AWS Cognito for authentication. This module
 * automates the login process through the browser so Sisyphus can operate
 * the dispatch UI as an authenticated user.
 *
 * NOTE: Selectors are marked with TODO comments and will need refinement
 * once tested against the live dispatch UI.
 */

import type { Page } from "playwright";
import { createChildLogger } from "../../lib/logger.js";

const log = createChildLogger("execution:browser:auth");

/** How long to wait for navigation and element appearance. */
const AUTH_TIMEOUT_MS = 30_000;

/** How long to wait for the post-login dashboard to appear. */
const POST_LOGIN_TIMEOUT_MS = 45_000;

/**
 * Authenticate with the dispatch UI through the Cognito login flow.
 *
 * @param page     - Playwright page to use for authentication
 * @param url      - Dispatch app URL (e.g. "https://dispatch.valleyeats.ca")
 * @param username - Cognito username (email)
 * @param password - Cognito password
 *
 * @throws If authentication fails or times out
 */
export async function authenticateDispatch(
  page: Page,
  url: string,
  username: string,
  password: string,
): Promise<void> {
  log.info({ url, username }, "Starting dispatch UI authentication");

  // Navigate to the dispatch app — this should redirect to Cognito login
  await page.goto(url, {
    waitUntil: "networkidle",
    timeout: AUTH_TIMEOUT_MS,
  });

  log.debug("Page loaded, looking for Cognito login form");

  // --- Cognito hosted UI login form ---
  // The Cognito hosted UI presents email + password fields.
  // Selectors vary by Cognito configuration (hosted UI vs embedded).

  // Wait for and fill the email/username field
  // TODO: Verify selector against live dispatch UI — Cognito hosted UI uses
  // different selectors than embedded Amplify UI components
  const emailInput = page.locator(
    'input[name="username"], input[name="email"], input[type="email"], [data-testid="username-input"]',
  ); // TODO: Verify selector against live dispatch UI
  await emailInput.waitFor({ state: "visible", timeout: AUTH_TIMEOUT_MS });
  await emailInput.fill(username);
  log.debug("Email field filled");

  // Fill the password field
  const passwordInput = page.locator(
    'input[name="password"], input[type="password"], [data-testid="password-input"]',
  ); // TODO: Verify selector against live dispatch UI
  await passwordInput.waitFor({ state: "visible", timeout: AUTH_TIMEOUT_MS });
  await passwordInput.fill(password);
  log.debug("Password field filled");

  // Click the sign-in / submit button
  const submitButton = page.locator(
    'button[type="submit"], input[type="submit"], [data-testid="sign-in-button"]',
  ); // TODO: Verify selector against live dispatch UI
  await submitButton.click();
  log.debug("Sign-in button clicked, waiting for authentication to complete");

  // Wait for successful authentication — look for a known post-login element.
  // After Cognito auth completes, the dispatch app redirects back and renders
  // the main dashboard. We look for a stable element that only appears when
  // the user is authenticated.
  try {
    await page.waitForURL((url) => !url.href.includes("cognito"), {
      timeout: POST_LOGIN_TIMEOUT_MS,
    });

    // Wait for the dispatch dashboard to render
    // TODO: Verify selector against live dispatch UI — pick a stable element
    // that's always present on the main dispatch dashboard
    const dashboardIndicator = page.locator(
      '[data-testid="dispatch-dashboard"], .dispatch-layout, [data-testid="main-nav"], #root .ant-layout',
    ); // TODO: Verify selector against live dispatch UI
    await dashboardIndicator.waitFor({ state: "visible", timeout: POST_LOGIN_TIMEOUT_MS });

    log.info("Authentication successful — dispatch dashboard loaded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Check for common failure indicators
    const pageContent = await page.content();
    if (pageContent.includes("Incorrect username or password")) {
      throw new Error("Authentication failed: incorrect username or password");
    }
    if (pageContent.includes("User does not exist")) {
      throw new Error("Authentication failed: user does not exist");
    }

    throw new Error(
      `Authentication failed — timed out waiting for dispatch dashboard to load: ${message}`,
    );
  }
}
