---
agent: customer-support
trigger: customer_search
priority: normal
version: "1.0"
---

# Customer Lookup

> Source: Dispatch Analyst Guide -- Customers section

## How to Find a Customer

Each customer is identified by their email address. Type the email address into the search bar to open that customer's information screen.

## Data Available on the Customer Profile

### Communication

- **Top left chat bubble**: Displays all messages sent to the customer through the app.

### Account Details

- **Stripe ID**: Links the customer's Valley Eats account to the payment processor (Stripe).
  - If a customer has no Stripe ID, they will get an error at checkout.
  - Fix: On their profile under Stripe ID, click "Create." Have the customer refresh the app. The issue should resolve.
- **Version #**: The version of the Valley Eats app the customer is using. Customers should be on version 3.1.0 or later for full support.

### Perks and Credits

- **Perks Points**: The customer's accumulated loyalty points from ordering. Do not modify these without a supervisor's instruction.
- **Convenience Free Orders**: The number of service fee credits the customer has. These are automatically applied at checkout and waive the service fee.

### Adding or Removing Service Fee Credits

1. Click the **"No fees"** button in the top right corner of the customer profile.
2. Type the number of credits to add.
3. To remove credits, enter a **negative number**.

**Important**: Never use the general "credit" button on the customer profile. Always go into a specific order to issue credits, so you can write notes explaining why the credit was issued.

### Payment Methods

- Visible in the top right corner of the customer profile.
- Clicking the **X** on a card deletes that payment method from Valley Eats systems.

### Background Notes

- The **"Background"** section contains notes about previous problems or concerns with the customer.
- Examples: hard-to-find address, history of false issue reports.
- Check this section before handling any customer interaction for context.

### Addresses

- Previous addresses the customer has used are listed under the **Address** section.
- You can manually edit addresses: click the address, type the correction, and hit **"Save Changes"**.
- Use this to add delivery instructions that need to be relayed to drivers every time the customer orders to a specific address.

### Orders

- The **Orders** section lists all previous orders the customer has placed.
- An order with status **"In Progress"** means the customer has not yet placed it -- items are only in their cart. They still need to go through checkout.
- Click the **green mail symbol** on any order to resend the receipt email to the customer.

### Delivery Instructions

- Each order has a **"Delivery Instructions"** section.
- You or the customer can type delivery instructions and press Enter to update.
- After updating delivery instructions on an active order: **send a ping or push notification to the driver** to make sure they see the change. Call or text the driver if it is time-sensitive.

### Transaction History

- Located at the very bottom of the customer profile.
- **Transaction ID**: Used by supervisors to search and confirm transactions within Stripe.
- **Payment/Refund type**: Indicates whether money was taken or returned.
- **Receipt**: Click the paper scroll icon on the far right to bring up the receipt.
- When sending customers proof of refund or charge: **always send a screen snip** (Windows: Shift+Win+S). Do not copy the receipt link.
