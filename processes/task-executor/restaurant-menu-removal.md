---
agent: task-executor
trigger: menu_item_disable_request
priority: normal
version: "1.0"
---

# Process: Restaurant Menu Item Removal / Disabling

## Trigger

When a restaurant requests that a menu item be removed, disabled, or paused. The Task Executor handles this as a shared utility -- it can be invoked by Customer Support, Market Monitor, or Supervisor.

Common triggers:
- Restaurant calls in to report they have run out of an item
- Restaurant requests an item be permanently removed from their menu
- Customer Support identifies a problematic menu item causing repeated order issues
- Restaurant requests a price correction or temporary disable

## Prerequisites

Before making any changes, gather the current state:
- [ ] `query_menu_items({ restaurantId: "{RestaurantId}", itemId: "{ItemId}" })` -- get the current item from `ValleyEats-MenuItems`
- [ ] `query_restaurants({ restaurantId: "{RestaurantId}" })` -- confirm restaurant is active, get `RestaurantName` and market
- [ ] `query_orders({ restaurantId, status: ["Pending", "Confirmed"] })` -- check for active orders containing this item
- [ ] If triggered by a ticket: `query_tickets({ issueId })` -- understand the context

## Critical Rules

**Source:** Dispatch Analyst Guide -- Taking Items off of the Menu.

1. **NEVER delete a menu item.** Even if the restaurant requests deletion, you will only **disable/pause** the item. It is far more work to re-create an item than to re-enable it. Create a ticket for growth@valleyeats.ca to confirm the removal.

2. **For major menu changes** (updating multiple prices, adding items, restructuring categories), the restaurant must email growth@valleyeats.ca. Customer Service Specialists handle only basic problems: disabling an item, correcting a single price, or basic troubleshooting.

3. **If a customer already has the item in their cart or has placed an order with it**, the item disable will not retroactively fix their order. Those orders must be manually corrected.

## Procedure: Disabling an Item via Vendor Portal

All menu item disabling is done through the **Vendor Portal** at `https://vendors.valleyeats.ca/`.

### Step 1: Access the Vendor Portal

1. Navigate to `https://vendors.valleyeats.ca/`
2. Log in using your dispatch credentials
3. You will see all restaurants listed alphabetically by market (Arnprior, Deepriver, Embrun, etc.)
4. Find the restaurant by scrolling to its market or using the "Search Restaurant" tab in the upper right corner

### Step 2: Navigate to the Restaurant Menu

1. Click on the restaurant to access their profile page
2. On the left side of the screen, under the restaurant's logo, click **"Menu"**
3. You will see all menu items organized by section (e.g., Appetizers, Breakfast, Mains)
4. Use **Ctrl+F** to search through menus efficiently

### Step 3: Disable the Item

**Method A -- Finding the item in its section:**
1. Click on the menu section where the item is located
2. Find the item in the list
3. Click the **pause button** underneath the item to disable it
4. The item will show as paused/disabled

**Method B -- Finding the item via search:**
1. Use the search function in the upper right corner of the menu page
2. Find the item in the search results
3. Click the **"Available"** button to toggle it off -- it will turn gray
4. Click **"Publish"** at the top of the page to save your changes

**Important:** Always click "Publish" after making changes via search to ensure the disable takes effect.

### Step 4: Disable Toppings, Sides, and Combo Components

If the restaurant asks you to disable a **topping, modifier, side, or drink** (e.g., ketchup, pickles, green olives), these items are NOT found in the regular menu sections or via standard search.

**You must use the Modifiers section:**
1. At the top of the menu page, click **"Modifiers"**
2. Search for the item you need to disable
3. Click on the section that appears in search results (e.g., searching "apple juice" may show "Choice of Drink")
4. **Multiple sections may appear** -- you must click into each one and pause the item in every section to ensure it is disabled across all combos and menus
5. Click the **pause button** beside the item in each modifier section

**Also disable sides/drinks in modifiers** when pausing them as regular items, so they are also paused within combo meals.

### Step 5: Handle Active Orders

After disabling the item, check for active orders that include it:
```
query_orders({ restaurantId, status: ["Pending", "Confirmed"], itemId: "..." })
```

If active orders contain the now-disabled item:
1. Contact the customer via Customer Support agent to offer a substitution or removal
2. If the customer wants a substitution, coordinate with the restaurant
3. If the customer wants the item removed, adjust the order total accordingly
4. Log all changes on the order and any associated ticket

### Step 6: Documentation

After disabling:
```
execute_action("AddTicketNote", {
  issueId: "...",
  note: "Disabled menu item [ItemName] for [RestaurantName] via Vendor Portal. Reason: [restaurant ran out / restaurant request / etc.]. Item paused, not deleted.",
  reason: "Menu item disable per restaurant request"
})
```

If the restaurant requested a permanent removal, create a follow-up ticket:
```
execute_action("CreateTicket", {
  category: "Menu Update",
  assignTo: "growth@valleyeats.ca",
  restaurantId: "...",
  description: "Restaurant [RestaurantName] has requested permanent removal of [ItemName]. Item has been disabled/paused. Please confirm removal.",
  reason: "Restaurant requested item deletion - paused by dispatch, needs Growth team confirmation"
})
```

## Price Corrections

For a simple price correction on a single item:
1. Navigate to the item in the Vendor Portal menu
2. Update the price field
3. Click **Save** on the item
4. Click **Publish** to apply changes
5. Document the change in a ticket note

For multiple price changes, direct the restaurant to email growth@valleyeats.ca.

## Menu Item Functions Reference

| Icon/Function | Purpose | Dispatch Use |
|--------------|---------|-------------|
| Pause | Disables item from customer ordering | **Primary tool -- use this** |
| Quantity | Sets stock count, decrements on order | Adjust if restaurant specifies limited stock |
| Prep Time | Additional prep time for this item | Adjust if restaurant reports item needs more time |
| Options | Configures modifiers (sizes, add-ons) | Can delete options but NOT items -- note in ticket |
| Availability | Sets day/time availability | Use for items only available certain days |
| Food Details | Alcohol flag, gluten, halal, taxable | Verify alcohol items are flagged correctly |
| Save | Saves changes to the system | **Always click after making changes** |
| Delete | Removes item permanently | **NEVER USE** |
| Picture (delete) | Removes item photo | **NEVER USE** |

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `UpdateMenuItem` | YELLOW | Disabling/pausing an item, adjusting price or availability |
| `AddTicketNote` | GREEN | Documenting the change on a related ticket |
| `CreateTicket` | GREEN | Creating follow-up for Growth team on permanent removals |

## Cooldown Rules

| Action | Minimum Wait | Notes |
|--------|-------------|-------|
| Toggle same item (same restaurant) | 5 minutes | Prevent rapid toggling |

## Escalation

Escalate to supervisor if:
- The request involves adding new items or restructuring the menu (Growth team work)
- Multiple items need complex changes (direct restaurant to email growth@valleyeats.ca)
- Active orders are affected and require cancellations (RED tier)
- The item disable reveals a deeper issue (e.g., restaurant wants to leave the platform)
- You are unsure whether an item is flagged correctly for alcohol

## Audit Requirements

Every menu change is logged with:
- `restaurantId`, `RestaurantName`, and `itemId`
- Action taken (paused, price updated, availability changed)
- Reason string referencing the source (ticket ID, phone call, restaurant request)
- Timestamp and executing agent identity
- Confirmation that "Publish" was clicked and changes are live

These records are reviewable in the dispatch activity log and included in the shift summary.
