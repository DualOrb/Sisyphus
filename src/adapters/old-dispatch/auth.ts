/**
 * Old dispatch authentication — Cognito redirect flow.
 *
 * The old dispatch (dispatch.valleyeats.ca) uses PHP sessions backed by
 * Cognito OAuth 2.0. The flow is:
 *
 *   1. Navigate to dispatch.valleyeats.ca
 *   2. PHP redirects to Cognito hosted UI (URL contains "cognito")
 *   3. Fill the Cognito login form (username + password)
 *   4. Cognito redirects back with an auth code
 *   5. PHP exchanges the code for tokens and creates a session
 *   6. The PHP session cookie (PHPSESSID) authenticates all `/post/*.php` calls
 *
 * After this flow completes, `extractSessionCookie` pulls the cookie from the
 * Playwright browser context so the OldDispatchClient can make direct HTTP calls.
 *
 * @see planning/12-old-dispatch-discovery.md — Authentication Flow
 */

import type { Page } from "playwright";
import { createChildLogger } from "../../lib/logger.js";

const log = createChildLogger("adapters:old-dispatch:auth");

/** How long to wait for Cognito redirect and page loads. */
const AUTH_TIMEOUT_MS = 30_000;

/** How long to wait for the dispatch dashboard after login. */
const POST_LOGIN_TIMEOUT_MS = 45_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Authenticate with the old dispatch UI through the Cognito login flow.
 *
 * @param page     - Playwright page
 * @param url      - Old dispatch URL (e.g. "https://dispatch.valleyeats.ca")
 * @param username - Cognito username (email)
 * @param password - Cognito password
 *
 * @throws If authentication fails or times out
 */
export async function authenticateOldDispatch(
  page: Page,
  url: string,
  username: string,
  password: string,
): Promise<void> {
  log.info({ url, username }, "Starting old dispatch authentication");

  // 1. Navigate to old dispatch — PHP will redirect to Cognito if no session
  await page.goto(url, {
    waitUntil: "networkidle",
    timeout: AUTH_TIMEOUT_MS,
  });

  // 2. Wait for the Cognito redirect (URL will contain "cognito")
  const currentUrl = page.url();
  if (currentUrl.includes("cognito")) {
    log.debug("Cognito login page detected");
  } else {
    // Already authenticated (session still valid) — check for dispatch dashboard
    const alreadyLoaded = await page
      .locator("#marketTabs, #deliveriestable")
      .first()
      .isVisible()
      .catch(() => false);
    if (alreadyLoaded) {
      log.info("Already authenticated — dispatch dashboard is visible");
      return;
    }

    // Wait a moment for the redirect to happen
    log.debug("Waiting for Cognito redirect...");
    await page.waitForURL((u) => u.href.includes("cognito"), {
      timeout: AUTH_TIMEOUT_MS,
    });
  }

  // 3. Fill the Cognito hosted UI login form
  log.debug("Filling Cognito login form");

  const usernameInput = page.locator('input[name="username"]');
  await usernameInput.waitFor({ state: "visible", timeout: AUTH_TIMEOUT_MS });
  await usernameInput.fill(username);

  const passwordInput = page.locator('input[name="password"]');
  await passwordInput.waitFor({ state: "visible", timeout: AUTH_TIMEOUT_MS });
  await passwordInput.fill(password);

  // 4. Submit the form
  const submitButton = page.locator(
    'input[type="submit"], button[type="submit"], button[name="signInSubmitButton"]',
  );
  await submitButton.click();
  log.debug("Login form submitted, waiting for redirect back to dispatch...");

  // 5. Wait for redirect back to dispatch (URL no longer contains "cognito")
  await page.waitForURL((u) => !u.href.includes("cognito"), {
    timeout: POST_LOGIN_TIMEOUT_MS,
  });

  // 6. Wait for the dispatch page to fully load
  try {
    const dashboardElement = page.locator("#marketTabs, #deliveriestable");
    await dashboardElement.first().waitFor({
      state: "visible",
      timeout: POST_LOGIN_TIMEOUT_MS,
    });
    log.info("Old dispatch authentication successful — dashboard loaded");
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
      `Authentication failed — timed out waiting for old dispatch dashboard: ${message}`,
    );
  }
}

/**
 * Extract the PHP session cookie from the browser context.
 *
 * After a successful Cognito login, the old dispatch sets a `PHPSESSID` cookie.
 * This cookie is all that's needed to authenticate subsequent `/post/*.php` calls.
 *
 * Returns a cookie string in the format expected by the `Cookie` HTTP header,
 * e.g. `"PHPSESSID=abc123; other=value"`.
 */
export async function extractSessionCookie(page: Page): Promise<string> {
  const context = page.context();
  const cookies = await context.cookies();

  // Filter cookies that belong to the dispatch domain
  const dispatchUrl = new URL(page.url());
  const domain = dispatchUrl.hostname;

  const relevantCookies = cookies.filter(
    (c) =>
      c.domain === domain ||
      c.domain === `.${domain}` ||
      domain.endsWith(c.domain.replace(/^\./, "")),
  );

  if (relevantCookies.length === 0) {
    log.warn({ domain }, "No cookies found for dispatch domain");
    return "";
  }

  // Build the Cookie header string
  const cookieStr = relevantCookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const phpSession = relevantCookies.find((c) => c.name === "PHPSESSID");
  if (phpSession) {
    log.debug("PHPSESSID cookie found");
  } else {
    log.warn("PHPSESSID cookie not found — session auth may fail");
  }

  return cookieStr;
}
