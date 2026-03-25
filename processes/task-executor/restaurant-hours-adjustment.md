---
agent: task-executor
trigger: restaurant_hours_change_request
priority: normal
version: "1.0"
---

# Process: Restaurant Hours Adjustment

## Trigger

When a restaurant requests a change to their operating hours (open/close times), or when a proactive adjustment is needed based on operational conditions. The Task Executor handles this as a shared utility.

Common triggers:
- Restaurant calls in requesting hours change (one-time or permanent)
- Restaurant submits hours change via vendor portal or ticket
- Market Monitor detects a restaurant is open/closed outside expected hours
- Supervisor delegates a scheduled hours update

## Prerequisites

Before making any changes, gather the current state:
- [ ] `query_restaurants({ restaurantId: "{RestaurantId}" })` -- full restaurant record including `KitchenHours`, `DefaultHours`, `RestaurantName`, `Phone`
- [ ] `get_entity_timeline("restaurant", restaurantId, hours=24)` -- check for recent changes to avoid conflicts
- [ ] `query_orders({ restaurantId, status: ["Pending", "Confirmed", "Ready"] })` -- check for active orders that may fall outside the new hours
- [ ] If triggered by a ticket: `query_tickets({ restaurantId })` -- understand the reported issue

**Hours format:** Hours are stored as **minutes from midnight** (e.g., 660 = 11:00 AM, 1320 = 10:00 PM).

## Critical Questions to Ask the Restaurant

**Source:** Dispatch Analyst Guide -- Adjusting Hours.

Before making any hours change, confirm these two things with the restaurant:

### 1. Is this a one-time change or permanent?

This determines the method used in the Vendor Portal.

### 2. Does the restaurant have split hours (multiple open/close periods per day)?

Some restaurants open for morning, close for an afternoon break, and reopen for dinner. **If the restaurant has split hours, DO NOT TOUCH THE HOURS.** Split hours must be manually edited by the technical team. Editing them directly will break the split hours configuration.

For split-hours restaurants:
1. Create a ticket and pass to supervisor
2. Note the requested change with full details
3. Halt the restaurant if needed for the time being (see `restaurant-halting.md`)

## Procedure: One-Time Hours Change (Holiday Hours)

Use **Holiday Hours** for any temporary or one-time change. Holiday Hours automatically revert to the regular schedule once the day has passed.

### Steps in the Vendor Portal

1. Navigate to `https://vendors.valleyeats.ca/`
2. Log in with dispatch credentials
3. Select the market, then click the restaurant
4. Click the **"Hours"** button on the restaurant page
5. Click on **"Holiday Hours"**
6. Set the date and the adjusted open/close times
7. Save the changes
8. Refresh the page to confirm the change has been applied

**When to use Holiday Hours instead of a permanent change:**
- Restaurant is closing early today only
- Restaurant is opening late for a special event
- Any change that applies to a single day

**Shortcut:** If the restaurant just needs to close early and it is close to their normal closing time, sometimes a **halt** is simpler than creating Holiday Hours. Confirm with the restaurant that a halt is acceptable. (A halt resets the following morning and resumes the regular schedule.)

## Procedure: Permanent Hours Change

For ongoing changes to the restaurant's regular operating schedule.

### Steps in the Vendor Portal

1. Navigate to `https://vendors.valleyeats.ca/`
2. Log in with dispatch credentials
3. Select the market, then click the restaurant
4. Click on **"Hours"** at the top left
5. For each day that needs updating, select the new time from the dropdown menu
6. Click **"Update Hours"**
7. **Refresh the page** after updating to verify the change has been applied
8. Confirm with the restaurant whether any current orders need to be picked up earlier due to the new hours

### After a Permanent Change

1. Create a note for the Restaurant Relations Coordinator documenting:
   - The restaurant name and ID
   - The new hours for each affected day
   - The reason for the change
   - Who requested it

Action (for the system record):
```
execute_action("UpdateRestaurant", {
  restaurantId: "...",
  field: "KitchenHours",
  value: { "Monday": { open: 660, close: 1320 }, ... },
  reason: "Restaurant requested permanent hours change via [ticket #IssueId / phone call on DATE]"
})
```

## Validation Checks

**Source:** Dispatch Analyst Guide -- "Always verify that the open time is before the close time and that AM/PM is set correctly."

Before saving any hours change:
1. **Open time must be before close time** -- verify AM/PM is correct
2. **Hours must be reasonable** -- not accidentally set to 24/7 unless intentional
3. **Check for active orders** -- if the new hours would cut off active orders, those orders must be handled first
4. **Refresh and verify** -- always refresh the Vendor Portal page after saving to confirm the change took effect

## Handling Active Orders Affected by Hours Change

If the restaurant is closing earlier and there are active orders scheduled after the new close time:

1. Identify all affected orders:
```
query_orders({ restaurantId, status: ["Pending", "Confirmed"], pickupAfter: newCloseTime })
```

2. For each affected order:
   - Contact the restaurant to confirm if they can still fulfill it before closing
   - If yes, expedite the order and notify the assigned courier
   - If no, escalate to supervisor -- order may need to be cancelled (RED tier)

3. Communicate any changes to affected customers via Customer Support agent

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `UpdateRestaurant` | YELLOW | Modifying hours (KitchenHours or DefaultHours) |
| `AddTicketNote` | GREEN | Documenting the change on a related ticket |
| `CreateTicket` | GREEN | Creating follow-up for technical team (split hours) or relations coordinator |

## Cooldown Rules

| Action | Minimum Wait | Notes |
|--------|-------------|-------|
| Update hours (same restaurant) | 5 minutes | Prevent rapid toggling |
| Hours + halt (same restaurant) | No cooldown | Halt may be used alongside hours change |

## Escalation

Escalate to supervisor (who may escalate to human or technical team) if:
- The restaurant has **split hours** -- do not edit directly, technical team must handle
- Active orders would be affected by the hours change
- The hours change source cannot be verified
- The restaurant is requesting unusual hours (e.g., 24/7 operation, extremely limited window)
- Multiple conflicting hours changes are requested

## Audit Requirements

Every hours change is logged with:
- `restaurantId` and `RestaurantName`
- Type of change (one-time Holiday Hours vs. permanent)
- Old hours and new hours for each affected day
- Reason string referencing the source (ticket ID, phone call, restaurant request)
- Timestamp and executing agent identity
- Whether the Vendor Portal page was refreshed to verify the change

These records are reviewable in the dispatch activity log and included in the shift summary.
