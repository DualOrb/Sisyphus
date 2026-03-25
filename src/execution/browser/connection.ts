/**
 * Playwright browser connection management via Chrome DevTools Protocol.
 *
 * Sisyphus connects to an already-running Chrome instance (started separately
 * or via the infrastructure layer) using CDP. This avoids launching a new
 * browser process on every shift — the browser persists across restarts.
 *
 * @see planning/09-ontology-layer-design.md section 8.1
 */

import { chromium, type Browser, type Page } from "playwright";
import { createChildLogger } from "../../lib/logger.js";

const log = createChildLogger("execution:browser:connection");

/**
 * Connect to an already-running Chrome instance via CDP.
 *
 * @param cdpUrl - WebSocket URL for Chrome DevTools Protocol
 *                 (default from env: CHROME_CDP_URL, e.g. "ws://localhost:9222")
 */
export async function connectBrowser(cdpUrl: string): Promise<Browser> {
  log.info({ cdpUrl }, "Connecting to Chrome via CDP");

  try {
    const browser = await chromium.connectOverCDP(cdpUrl);
    log.info("Successfully connected to Chrome");
    return browser;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ cdpUrl, error: message }, "Failed to connect to Chrome via CDP");
    throw new Error(`Failed to connect to Chrome at ${cdpUrl}: ${message}`);
  }
}

/**
 * Create a new page in the browser's default context.
 *
 * Used to get a fresh page for dispatch UI interaction. If the browser
 * already has contexts (e.g. from a previous CDP connection), uses the
 * first existing context; otherwise creates a new one.
 */
export async function createDispatchPage(browser: Browser): Promise<Page> {
  log.debug("Creating new dispatch page");

  const contexts = browser.contexts();
  const context = contexts.length > 0
    ? contexts[0]
    : await browser.newContext();

  const page = await context.newPage();
  log.info("Dispatch page created");
  return page;
}

/**
 * Gracefully disconnect from the browser.
 *
 * This does NOT close the Chrome process — it only severs the CDP connection.
 * The browser continues running for the next Sisyphus shift or manual use.
 */
export async function disconnectBrowser(browser: Browser): Promise<void> {
  log.info("Disconnecting from Chrome");

  try {
    await browser.close();
    log.info("Chrome connection closed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn({ error: message }, "Error while disconnecting from Chrome (may already be closed)");
  }
}
