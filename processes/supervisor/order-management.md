---
agent: supervisor
trigger: order_status_change
priority: high
version: "1.0"
---

# Order Management

**Trigger:** Order progresses through statuses or requires intervention.

**Check First:**
- Current order status and timestamps
- HUD and ETA badges for the assigned courier

**Steps:**
1. **Status progression:** Placed > Confirmed (restaurant) > Confirmed (both) > En-Route > Ready > At Restaurant > In Bag > In Transit > Delivered/Completed. Canceled triggers auto refund -- MUST call restaurant first to confirm they haven't started.
2. **Key behaviors:** En-Route sends restaurant notification (some wait to start prep). In Bag starts 5-min In Transit countdown for customer. In Transit shows customer live courier location -- never multiple to different locations. At Restaurant marked >5 min before pickup = contact courier, ask not to arrive too early.
3. **Intervention triggers:** order within 10 min of pickup, restaurant hasn't confirmed = call restaurant. Red background = unconfirmed within 11 min. Red box = 10+ min past pickup, not In Bag (urgent -- get courier there, communicate to restaurant). Yellow/red ETA badge = consider rerouting.
4. **Modifying ready time:** click time and add +/- minutes, or edit directly. Only with accurate updates. >10 min change = call restaurant.
5. **Re-dispatch:** customer wants food resent + is available + restaurant open + drivers available + order Completed + today's date. Order Corrections > Re-Dispatch > choose fault > describe items > set pickup time > verify on dispatch screen.
6. **Cross-market orders (red/blue background):** bundle, plan return trips, max 3 in-bag.

**Escalate If:**
- Order needs cancellation (RED tier -- call restaurant first)
- Re-dispatch required but no drivers available
- System anomaly in status progression
