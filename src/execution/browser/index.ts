// Browser execution — Playwright-based dispatch UI automation.

export { connectBrowser, createDispatchPage, disconnectBrowser } from "./connection.js";
export { authenticateDispatch } from "./auth.js";
export { BrowserExecutor } from "./executor.js";
