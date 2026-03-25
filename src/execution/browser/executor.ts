/**
 * Browser executor — translates ontology actions into Playwright browser automation.
 *
 * Each action handler navigates the dispatch-new React/Ant Design UI, fills forms,
 * clicks buttons, and verifies outcomes. This executor is used for actions that
 * need to be visible to human dispatchers in the UI.
 *
 * All CSS selectors are marked with TODO comments — they will need to be verified
 * and refined once tested against the live dispatch UI.
 *
 * @see planning/09-ontology-layer-design.md section 8.1
 */

import type { Page } from "playwright";
import { createChildLogger } from "../../lib/logger.js";
import type { ActionExecutor, ExecutionResult } from "../types.js";

const log = createChildLogger("execution:browser:executor");

/** Default timeout for waiting on UI elements (ms). */
const ELEMENT_TIMEOUT = 10_000;

/** Timeout for navigation actions (ms). */
const NAVIGATION_TIMEOUT = 15_000;

export class BrowserExecutor implements ActionExecutor {
  constructor(private readonly page: Page) {}

  // -------------------------------------------------------------------------
  // ActionExecutor interface
  // -------------------------------------------------------------------------

  async execute(
    actionName: string,
    params: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const start = Date.now();
    log.info({ actionName, params }, "Browser executor: starting action");

    try {
      switch (actionName) {
        case "AssignDriverToOrder":
          await this.assignDriverToOrder(
            params.orderId as string,
            params.driverId as string,
          );
          break;

        case "SendDriverMessage":
          await this.sendDriverMessage(
            params.driverId as string,
            params.message as string,
          );
          break;

        case "UpdateOrderStatus":
          await this.updateOrderStatus(
            params.orderId as string,
            params.newStatus as string,
          );
          break;

        case "ReassignOrder":
          await this.reassignOrder(
            params.orderId as string,
            params.newDriverId as string,
            params.reason as string,
          );
          break;

        case "ResolveTicket":
          await this.resolveTicket(
            params.ticketId as string,
            params.resolution as string,
            params.resolutionType as string | undefined,
          );
          break;

        default: {
          const duration = Date.now() - start;
          log.warn({ actionName }, "Browser executor: unknown action");
          return {
            success: false,
            method: "browser",
            duration,
            error: `Browser executor does not handle action "${actionName}"`,
          };
        }
      }

      const duration = Date.now() - start;
      log.info({ actionName, duration }, "Browser executor: action completed successfully");
      return { success: true, method: "browser", duration };
    } catch (error) {
      const duration = Date.now() - start;
      const message = error instanceof Error ? error.message : String(error);
      log.error({ actionName, duration, error: message }, "Browser executor: action failed");
      return { success: false, method: "browser", duration, error: message };
    }
  }

  // -------------------------------------------------------------------------
  // Navigation helpers
  // -------------------------------------------------------------------------

  /**
   * Navigate to a specific order's detail page in the dispatch UI.
   * Orders are identified by UUID (full orderId) or 8-char short key (orderIdKey).
   */
  private async navigateToOrder(orderId: string): Promise<void> {
    log.debug({ orderId }, "Navigating to order");

    // TODO: Verify URL pattern against live dispatch UI
    // The dispatch-new app likely uses hash or path-based routing for order details
    const orderUrl = `/orders/${orderId}`;
    await this.page.goto(orderUrl, { waitUntil: "networkidle", timeout: NAVIGATION_TIMEOUT });

    // Wait for the order detail view to load
    const orderDetail = this.page.locator(
      '[data-testid="order-detail"], .order-detail, .ant-card',
    ); // TODO: Verify selector against live dispatch UI
    await orderDetail.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
  }

  /**
   * Navigate to a specific ticket/issue detail page.
   * Issues use 8-char hash IDs (e.g. "b04b887b").
   */
  private async navigateToTicket(ticketId: string): Promise<void> {
    log.debug({ ticketId }, "Navigating to ticket");

    // TODO: Verify URL pattern against live dispatch UI
    const ticketUrl = `/support/issues/${ticketId}`;
    await this.page.goto(ticketUrl, { waitUntil: "networkidle", timeout: NAVIGATION_TIMEOUT });

    // Wait for the ticket detail view to load
    const ticketDetail = this.page.locator(
      '[data-testid="issue-detail"], .issue-detail, .ant-card',
    ); // TODO: Verify selector against live dispatch UI
    await ticketDetail.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
  }

  /**
   * Open the messaging/chat panel in the dispatch UI.
   * The dispatch app has a sidebar or dedicated section for driver conversations.
   */
  private async openMessaging(): Promise<void> {
    log.debug("Opening messaging panel");

    // TODO: Verify selector against live dispatch UI
    const messagingNav = this.page.locator(
      '[data-testid="messaging-nav"], [data-testid="messages-tab"], a[href*="message"], .nav-messages',
    ); // TODO: Verify selector against live dispatch UI
    await messagingNav.click();

    // Wait for the messaging panel to be visible
    const messagingPanel = this.page.locator(
      '[data-testid="messaging-panel"], .messaging-panel, .chat-panel',
    ); // TODO: Verify selector against live dispatch UI
    await messagingPanel.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
  }

  // -------------------------------------------------------------------------
  // Action handlers
  // -------------------------------------------------------------------------

  /**
   * Assign a driver to an unassigned order.
   *
   * Flow: navigate to order -> click assign button -> search/select driver -> confirm
   */
  private async assignDriverToOrder(orderId: string, driverId: string): Promise<void> {
    log.info({ orderId, driverId }, "Assigning driver to order");

    await this.navigateToOrder(orderId);

    // Click the "Assign Driver" button on the order detail page
    const assignButton = this.page.locator(
      '[data-testid="assign-driver-btn"], button:has-text("Assign Driver"), button:has-text("Assign")',
    ); // TODO: Verify selector against live dispatch UI
    await assignButton.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
    await assignButton.click();

    // Wait for the driver selection modal/dropdown to appear
    const driverSelector = this.page.locator(
      '[data-testid="driver-select"], .ant-select, .driver-selector',
    ); // TODO: Verify selector against live dispatch UI
    await driverSelector.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });

    // Search for the driver by ID (email address in ValleyEats)
    const searchInput = this.page.locator(
      '[data-testid="driver-search"], .ant-select-selection-search-input, input[placeholder*="driver"], input[placeholder*="search"]',
    ); // TODO: Verify selector against live dispatch UI
    await searchInput.fill(driverId);

    // Wait for search results and select the driver
    const driverOption = this.page.locator(
      `[data-testid="driver-option-${driverId}"], .ant-select-item[title*="${driverId}"], .ant-select-item-option:has-text("${driverId}")`,
    ); // TODO: Verify selector against live dispatch UI
    await driverOption.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
    await driverOption.click();

    // Confirm the assignment
    const confirmButton = this.page.locator(
      '[data-testid="confirm-assign"], button:has-text("Confirm"), .ant-modal-footer button.ant-btn-primary',
    ); // TODO: Verify selector against live dispatch UI
    await confirmButton.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
    await confirmButton.click();

    // Wait for confirmation that assignment succeeded (e.g. toast, status change)
    const successIndicator = this.page.locator(
      '.ant-message-success, .ant-notification-notice, [data-testid="assign-success"]',
    ); // TODO: Verify selector against live dispatch UI
    await successIndicator.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });

    log.info({ orderId, driverId }, "Driver assigned to order successfully");
  }

  /**
   * Send a message to a driver via the dispatch messaging panel.
   *
   * Flow: open messaging -> select conversation -> type message -> send
   */
  private async sendDriverMessage(driverId: string, message: string): Promise<void> {
    log.info({ driverId, messageLength: message.length }, "Sending driver message");

    await this.openMessaging();

    // Select or search for the driver's conversation
    // Driver IDs are email addresses in ValleyEats
    const conversationSearch = this.page.locator(
      '[data-testid="conversation-search"], input[placeholder*="search"], .conversation-search input',
    ); // TODO: Verify selector against live dispatch UI
    await conversationSearch.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
    await conversationSearch.fill(driverId);

    // Click on the driver's conversation in the list
    const conversationItem = this.page.locator(
      `[data-testid="conversation-${driverId}"], .conversation-item:has-text("${driverId}"), .ant-list-item:has-text("${driverId}")`,
    ); // TODO: Verify selector against live dispatch UI
    await conversationItem.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
    await conversationItem.click();

    // Type the message
    const messageInput = this.page.locator(
      '[data-testid="message-input"], textarea[placeholder*="message"], .message-input textarea, .chat-input textarea',
    ); // TODO: Verify selector against live dispatch UI
    await messageInput.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
    await messageInput.fill(message);

    // Click the send button
    const sendButton = this.page.locator(
      '[data-testid="send-message-btn"], button:has-text("Send"), .send-button, button[aria-label="Send"]',
    ); // TODO: Verify selector against live dispatch UI
    await sendButton.click();

    // Wait briefly for the message to appear in the chat
    // TODO: Verify selector against live dispatch UI — look for the sent message
    const sentMessage = this.page.locator(
      `.message-bubble:has-text("${message.slice(0, 30)}"), .chat-message:last-child`,
    ); // TODO: Verify selector against live dispatch UI
    await sentMessage.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });

    log.info({ driverId }, "Message sent to driver successfully");
  }

  /**
   * Update the status of an order.
   *
   * Flow: navigate to order -> find status control -> select new status -> confirm
   */
  private async updateOrderStatus(orderId: string, newStatus: string): Promise<void> {
    log.info({ orderId, newStatus }, "Updating order status");

    await this.navigateToOrder(orderId);

    // Find and click the status dropdown/control
    const statusControl = this.page.locator(
      '[data-testid="order-status-select"], .order-status .ant-select, .status-dropdown, button:has-text("Status")',
    ); // TODO: Verify selector against live dispatch UI
    await statusControl.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
    await statusControl.click();

    // Select the new status from the dropdown
    const statusOption = this.page.locator(
      `[data-testid="status-option-${newStatus}"], .ant-select-item:has-text("${newStatus}"), .ant-dropdown-menu-item:has-text("${newStatus}")`,
    ); // TODO: Verify selector against live dispatch UI
    await statusOption.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
    await statusOption.click();

    // Some status changes may require confirmation (especially cancellations)
    const confirmButton = this.page.locator(
      '[data-testid="confirm-status-change"], .ant-modal-footer button.ant-btn-primary, .ant-popconfirm-buttons button.ant-btn-primary',
    ); // TODO: Verify selector against live dispatch UI

    // Only click confirm if a confirmation dialog appears (not all transitions need it)
    const confirmVisible = await confirmButton.isVisible().catch(() => false);
    if (confirmVisible) {
      await confirmButton.click();
    }

    // Wait for success indicator
    const successIndicator = this.page.locator(
      '.ant-message-success, .ant-notification-notice, [data-testid="status-update-success"]',
    ); // TODO: Verify selector against live dispatch UI
    await successIndicator.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });

    log.info({ orderId, newStatus }, "Order status updated successfully");
  }

  /**
   * Reassign an order to a different driver.
   *
   * Flow: navigate to order -> click reassign -> select new driver -> provide reason -> confirm
   * Similar to assignDriverToOrder but for already-assigned orders.
   */
  private async reassignOrder(
    orderId: string,
    newDriverId: string,
    reason: string,
  ): Promise<void> {
    log.info({ orderId, newDriverId, reason }, "Reassigning order");

    await this.navigateToOrder(orderId);

    // Click the "Reassign" button (may be in a dropdown menu or directly visible)
    const reassignButton = this.page.locator(
      '[data-testid="reassign-btn"], button:has-text("Reassign"), .ant-dropdown-menu-item:has-text("Reassign")',
    ); // TODO: Verify selector against live dispatch UI
    await reassignButton.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
    await reassignButton.click();

    // Wait for the reassignment modal to appear
    const reassignModal = this.page.locator(
      '[data-testid="reassign-modal"], .ant-modal:has-text("Reassign"), .reassign-modal',
    ); // TODO: Verify selector against live dispatch UI
    await reassignModal.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });

    // Search for and select the new driver
    const driverSearchInput = reassignModal.locator(
      '[data-testid="driver-search"], .ant-select-selection-search-input, input[placeholder*="driver"]',
    ); // TODO: Verify selector against live dispatch UI
    await driverSearchInput.fill(newDriverId);

    const driverOption = reassignModal.locator(
      `.ant-select-item:has-text("${newDriverId}"), .ant-select-item-option:has-text("${newDriverId}")`,
    ); // TODO: Verify selector against live dispatch UI
    await driverOption.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
    await driverOption.click();

    // Fill in the reason for reassignment
    const reasonInput = reassignModal.locator(
      '[data-testid="reassign-reason"], textarea[placeholder*="reason"], input[placeholder*="reason"]',
    ); // TODO: Verify selector against live dispatch UI
    const reasonVisible = await reasonInput.isVisible().catch(() => false);
    if (reasonVisible) {
      await reasonInput.fill(reason);
    }

    // Confirm the reassignment
    const confirmButton = reassignModal.locator(
      '[data-testid="confirm-reassign"], button:has-text("Confirm"), button.ant-btn-primary',
    ); // TODO: Verify selector against live dispatch UI
    await confirmButton.click();

    // Wait for confirmation
    const successIndicator = this.page.locator(
      '.ant-message-success, .ant-notification-notice, [data-testid="reassign-success"]',
    ); // TODO: Verify selector against live dispatch UI
    await successIndicator.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });

    log.info({ orderId, newDriverId }, "Order reassigned successfully");
  }

  /**
   * Resolve a support ticket with a resolution note.
   *
   * Flow: navigate to ticket -> add resolution note -> change status to resolved -> confirm
   */
  private async resolveTicket(
    ticketId: string,
    resolution: string,
    resolutionType?: string,
  ): Promise<void> {
    log.info({ ticketId, resolutionType }, "Resolving ticket");

    await this.navigateToTicket(ticketId);

    // Click the "Resolve" button or open the resolution form
    const resolveButton = this.page.locator(
      '[data-testid="resolve-ticket-btn"], button:has-text("Resolve"), button:has-text("Close Issue")',
    ); // TODO: Verify selector against live dispatch UI
    await resolveButton.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
    await resolveButton.click();

    // Wait for the resolution form/modal
    const resolutionForm = this.page.locator(
      '[data-testid="resolution-form"], .ant-modal:has-text("Resolve"), .resolution-form',
    ); // TODO: Verify selector against live dispatch UI
    await resolutionForm.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });

    // Select resolution type if available and specified
    if (resolutionType) {
      const typeSelect = resolutionForm.locator(
        '[data-testid="resolution-type-select"], .ant-select, select[name="resolutionType"]',
      ); // TODO: Verify selector against live dispatch UI
      const typeVisible = await typeSelect.isVisible().catch(() => false);
      if (typeVisible) {
        await typeSelect.click();
        const typeOption = this.page.locator(
          `.ant-select-item:has-text("${resolutionType}"), option:has-text("${resolutionType}")`,
        ); // TODO: Verify selector against live dispatch UI
        await typeOption.click();
      }
    }

    // Fill in the resolution note
    const resolutionInput = resolutionForm.locator(
      '[data-testid="resolution-note"], textarea[placeholder*="resolution"], textarea[placeholder*="note"], textarea',
    ); // TODO: Verify selector against live dispatch UI
    await resolutionInput.fill(resolution);

    // Confirm the resolution
    const confirmButton = resolutionForm.locator(
      '[data-testid="confirm-resolve"], button:has-text("Confirm"), button:has-text("Submit"), button.ant-btn-primary',
    ); // TODO: Verify selector against live dispatch UI
    await confirmButton.click();

    // Wait for confirmation that ticket was resolved
    const successIndicator = this.page.locator(
      '.ant-message-success, .ant-notification-notice, [data-testid="resolve-success"]',
    ); // TODO: Verify selector against live dispatch UI
    await successIndicator.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });

    log.info({ ticketId }, "Ticket resolved successfully");
  }
}
