---
agent: task-executor
trigger: menu_item_disable_request
priority: normal
version: "1.0"
---

# Restaurant Menu Item Removal / Disabling

**Trigger:** Restaurant requests a menu item be removed, disabled, or paused (ran out, permanent removal, problematic item, price correction).

**Check First:**
- Current item details from ValleyEats-MenuItems
- Restaurant is active
- Active orders containing this item
- Related ticket context if applicable

**Steps:**
1. **NEVER delete a menu item.** Always pause/disable only. Create a ticket for growth@valleyeats.ca to confirm any permanent removal.
2. For major menu changes (multiple prices, adding items, restructuring): direct restaurant to email growth@valleyeats.ca. Dispatch handles only: disable item, single price correction, basic troubleshooting.
3. Disable via Vendor Portal: find item in menu section and click pause, OR use search and toggle "Available" off then click Publish.
4. **For toppings/sides/drinks in combos:** go to Modifiers section, search the item, pause it in EVERY section that appears (multiple sections may exist).
5. Check for active orders containing the disabled item. If found, contact customer to offer substitution or removal; adjust order total accordingly.
6. Document the change in a ticket note. If permanent removal requested, create follow-up ticket for growth@valleyeats.ca.
7. For single price corrections: update price in Vendor Portal, Save, Publish.

**Escalate If:**
- Request involves adding new items or restructuring menu (Growth team work)
- Multiple items need complex changes
- Active orders affected and require cancellations (RED tier)
- Item disable reveals deeper issue (restaurant wants to leave platform)
- Unsure about alcohol flag on an item
