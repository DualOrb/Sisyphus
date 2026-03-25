---
agent: task-executor
trigger: menu_update_request
priority: low
version: "1.0"
---

# Process: Menu Item Management

## Trigger

When any agent requests a change to a restaurant's menu items. The Task Executor handles menu management as a shared utility -- it can be invoked by the supervisor, Customer Support, Driver Comms, or Market Monitor.

Common triggers:
- Restaurant requests an item be marked unavailable (via vendor portal message or phone call logged in a ticket)
- Customer Support resolves a ticket about a wrong menu item and needs it disabled
- Market Monitor detects orders failing because of a menu item issue
- Restaurant requests a price update or description change

## Prerequisites

Before making any menu changes, gather the current state:
- [ ] `query_menu_items({ restaurantId: "{RestaurantId}", itemId: "{ItemId}" })` -- get the current item from `ValleyEats-MenuItems`
- [ ] `query_restaurants({ restaurantId: "{RestaurantId}" })` -- confirm the restaurant is active (`Restaurant: true`) and who owns it
- [ ] `get_entity_timeline("restaurant", restaurantId, hours=24)` -- check for recent changes to avoid conflicts
- [ ] If triggered by a ticket: `query_tickets({ issueId })` -- understand the context

**Table structure:** `ValleyEats-MenuItems` uses a **composite key**:
- **Partition Key (PK):** `RestaurantId` (UUID)
- **Sort Key (SK):** `ItemId` (UUID)

This means every menu item is uniquely identified by the combination of `RestaurantId` + `ItemId`.

## Types of Updates

### 1. Toggle Item Availability

The most common menu operation. Marks an item as available or unavailable without removing it from the menu.

**When to toggle OFF (mark unavailable):**
- Restaurant reports they are out of a particular item
- Customer Support reports repeated issues with a specific item
- Item causes order errors (wrong item packed, preparation issues)

**When to toggle ON (mark available):**
- Restaurant confirms the item is back in stock
- A previously disabled item is ready to be relisted

**Verification before toggling:**
1. Confirm the request comes from a legitimate source:
   - Restaurant owner/manager request (via ticket or vendor portal)
   - Customer Support agent identifying a problematic item
   - Supervisor directive
2. If toggling OFF: check if any active orders include this item (`query_orders({ restaurantId, status: ["Pending", "Confirmed"] })` -- scan `OrderItems` for matching `ItemId`)
   - If active orders contain this item: warn the requesting agent but proceed with the toggle (the order has already been placed)
3. If toggling ON: no additional checks needed

**Action:**
```
execute_action("UpdateMenuItem", {
  restaurantId: "...",
  itemId: "...",
  field: "Available",
  value: true | false,
  reason: "Restaurant reported out of stock / Item back in stock per restaurant confirmation"
})
```

### 2. Update Price

Changing the price of a menu item. Prices are stored in **cents** (integers).

**Verification before changing price:**
1. **Source verification is mandatory.** Price changes must come from:
   - Restaurant owner/manager (via ticket or vendor portal submission)
   - Authorized operations staff
   - Do NOT update prices based on customer or driver reports alone
2. Confirm the new price is reasonable:
   - Price should not change by more than 50% in a single update (flag if it does)
   - Price should be > 0 cents
   - Compare against similar items at the restaurant
3. Check for active orders with this item -- active orders retain the price at the time of order, but verify that the change is intended for future orders only

**Action:**
```
execute_action("UpdateMenuItem", {
  restaurantId: "...",
  itemId: "...",
  field: "Price",
  value: 1500,  // new price in cents
  reason: "Price updated per restaurant owner request in ticket #{IssueId}. Old price: 1200, new price: 1500."
})
```

### 3. Update Description

Changing the description text of a menu item.

**Verification:**
1. Source must be the restaurant owner or authorized staff
2. Description should be a reasonable length (not empty, not excessively long)
3. Description should not contain contact information, promotional codes, or off-platform ordering instructions

**Action:**
```
execute_action("UpdateMenuItem", {
  restaurantId: "...",
  itemId: "...",
  field: "Description",
  value: "New description text here",
  reason: "Description updated per restaurant request in ticket #{IssueId}"
})
```

## Verification Checklist (All Menu Changes)

Every menu update must pass these checks before execution:

1. **Source verification:** Where did the request originate? Ticket ID, agent name, or monitoring alert?
2. **Restaurant is active:** `Restaurant: true` -- do not modify menus for inactive restaurants
3. **No conflicting changes:** Check `get_entity_timeline("restaurant", restaurantId, hours=24)` to ensure no one else has modified this item recently
4. **Reasonable change:** Does the update make sense? (e.g., not setting price to 0, not removing a description that's needed)
5. **Restaurant confirmation:** For price changes and new item additions, confirmation from the restaurant is required. Availability toggles can proceed on operational judgment.

If any check fails, report back to the requesting agent with the issue. Do NOT proceed with an unverified change.

## Bulk Operations

If a restaurant requests multiple items be toggled (e.g., "we're out of all seafood items"):

1. Identify all affected items from `MenuItems` table
2. Process each item individually -- this ensures each action is audited separately
3. Log a summary note: `execute_action("AddTicketNote", { note: "Bulk menu update: toggled {N} items to unavailable for {RestaurantName}. Items: {list}." })`
4. If the bulk operation affects more than 10 items, escalate to supervisor for confirmation before proceeding

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `UpdateMenuItem` | YELLOW | Toggling availability, updating price, updating description |
| `AddTicketNote` | GREEN | Documenting the change on a related ticket |
| `request_clarification` | -- | Large price change, bulk operation, or unverified source |

## Cooldown Rules

| Action | Minimum Wait | Notes |
|--------|-------------|-------|
| Update same item (same restaurant) | 5 minutes | Prevent rapid toggling |
| Bulk toggle (same restaurant) | 10 minutes | Allow restaurant to confirm the full list |

## Escalation

Escalate to supervisor if:
- Price change exceeds 50% of the current price (suspicious)
- Bulk operation affects more than 10 items (confirm intent)
- The request source cannot be verified
- The restaurant is inactive and someone is requesting menu changes
- Multiple conflicting requests for the same item

## Audit Requirements

Every menu change is logged by the ontology action layer with:
- `restaurantId` and `RestaurantName`
- `itemId` and `ItemName`
- Field changed, old value, new value
- Reason string (must reference the source: ticket ID, alert, or requesting agent)
- Timestamp and executing agent identity

These records are reviewable in the dispatch activity log and included in the shift summary.
