---
agent: customer-support
trigger: ticket_type_late
priority: high
version: "1.0"
---

# Process: Late Delivery Resolution

## Trigger

When a support ticket with `IssueType: "Late Delivery"` (or `IssueType: "Other"` with a description mentioning lateness) is assigned to the Customer Support agent. Also triggered when the Market Monitor or supervisor detects that an in-progress order has exceeded its expected delivery window.

## Prerequisites

Before investigating, gather full context:
- [ ] `query_tickets({ issueId: "{IssueId}" })` -- get the ticket with `Category`, `IssueType`, `IssueStatus`, `Description`, `Messages`, `Notes`, `Actions`
- [ ] `get_order_details(ticket.OrderId)` -- full order with lifecycle timestamps (all Unix epoch seconds)
- [ ] `get_entity_timeline("order", ticket.OrderId, hours=4)` -- recent actions on this order
- [ ] `query_drivers({ driverId: order.DriverId })` -- driver's current status (`Available`, `Paused`, `ConnectionId`)
- [ ] `query_restaurants({ restaurantId: order.RestaurantId })` -- restaurant status, `LastHeartbeat`, `POSETA`
- [ ] `query_market_health({ market: order.DeliveryZone })` -- current zone health (`Score`, `idealDrivers`, `drivers`)

**Reminder:** All timestamps are Unix epoch **seconds**. All monetary values are in **cents** (integers). `OrderTotal: 6695` means $66.95.

## Step 1: Confirm the Order Is Actually Late

Calculate delay using DynamoDB timestamp fields:

```
current_time = Math.floor(Date.now() / 1000)

# Expected delivery window:
# From OrderPlacedTime, a typical delivery takes ~30-45 min
expected_delivery_by = OrderPlacedTime + (45 * 60)  // 45 minutes

# Is the order late?
is_late = current_time > expected_delivery_by && OrderDeliveredTime == null
delay_minutes = Math.floor((current_time - expected_delivery_by) / 60)
```

Additional lateness signals:
- `OrderReadyTime` is set but `EnrouteTime` is null -- food is ready but no driver is moving
- `EnrouteTime` is set but `OrderInTransitTime` is null -- driver went enroute but hasn't picked up
- `OrderInTransitTime` is set but `AtCustomerTime` is null -- driver has the food but hasn't arrived
- `DriverAssignedTime` is null -- no driver was ever assigned

If the order is NOT late (customer perception vs. reality), respond with an ETA update and close the ticket with an explanation.

## Step 2: Identify the Cause

Work through these checks in order. The **first match** is the primary cause:

### Cause A: No Driver Assigned

**Detection:**
- `DriverId` is null
- `DriverAssignedTime` is null

**This is the most critical scenario.** The order has been sitting with no driver.

**Age check:**
- `now - OrderPlacedTime` gives total wait time in seconds
- If > 1800 seconds (30 min): this is a severe failure

### Cause B: Restaurant Delay

**Detection:**
- `DeliveryConfirmedTime` is null (restaurant never confirmed the order)
- OR: `DeliveryConfirmedTime` is set but `OrderReadyTime` is null (restaurant confirmed but food isn't ready)
- Compare `DeliveryConfirmedTime - OrderPlacedTime` -- if > 900 seconds (15 min), the restaurant was slow to confirm

**Restaurant health check:**
- Query `RestaurantHealthCache` for this `RestaurantId`
- Check `LastHeartbeat` -- if `now - LastHeartbeat > 300` (5 min), the tablet may be offline
- Check `POSETA` (prep time estimate in minutes) -- is the delay within their stated prep time?

### Cause C: Driver Delay

**Detection:**
- `DriverAssignedTime` is set AND `DriverId` is set
- Calculate driver response time: `EnrouteTime - DriverAssignedTime`
  - If > 600 seconds (10 min): driver was slow to start
- Calculate pickup delay: `OrderInBagTime - OrderReadyTime` (if both set)
  - If > 600 seconds: driver took too long at the restaurant
- Calculate transit delay: if `OrderInTransitTime` is set but `AtCustomerTime` is null and `now - OrderInTransitTime > 1200` (20 min), driver may be lost or stuck

**Driver status check:**
- `ConnectionId` -- is the driver still online?
- `Available` and `Paused` -- has the driver gone offline mid-delivery?
- Check `DriverMessages` (via `get_entity_timeline`) for any communication from the driver

### Cause D: System Issue

**Detection:**
- None of the above causes are clear
- OR: timestamps show impossible sequences (e.g., `EnrouteTime < DriverAssignedTime`)
- OR: `MarketMeters.Score > 80` suggesting a system-wide problem

## Step 3: Resolution by Cause

### Cause A Resolution: No Driver Assigned

1. **Immediate:** Escalate for urgent driver reassignment:
   ```
   request_clarification({
     urgency: "critical",
     category: "unassigned_order",
     orderId: "...",
     waitMinutes: N,
     recommendation: "Urgent reassignment needed — customer has been waiting N minutes with no driver"
   })
   ```

2. **Customer communication:** Send apology with honest status update (see templates below)

3. **Refund:** Apply delay-based refund per `refund-policy.md`:
   - 30-45 min late: 25% of `OrderSubtotal`
   - 45-60 min late: 50% of `OrderSubtotal`
   - Over 60 min late: 75% of `OrderSubtotal`
   - If the order is ultimately never delivered: full refund of `OrderTotal`

4. **Document:** Add ticket note with findings

### Cause B Resolution: Restaurant Delay

1. **Customer communication:** Apologize and explain the delay is on the restaurant side

2. **Refund:** Apply delay-based credit per `refund-policy.md`:
   - Minor delay (< 30 min): 500 cents ($5.00) store credit
   - Moderate delay (30-45 min): 25% of `OrderSubtotal`
   - Severe delay (45+ min): 50% of `OrderSubtotal`

3. **Restaurant health note:** Create a note for the restaurant's health tracking:
   ```
   execute_action("AddTicketNote", {
     ticketId: "...",
     note: "RESTAURANT DELAY: RestaurantId {RestaurantId} ({RestaurantName}) — order confirmed at {DeliveryConfirmedTime} but food not ready until {OrderReadyTime}. Delay: N minutes. Flagging for restaurant health review."
   })
   ```

4. **If pattern detected:** Check `RestaurantHealthCache` -- if the restaurant has a history of delays, escalate to supervisor for a conversation with the restaurant

### Cause C Resolution: Driver Delay

1. **Customer communication:** Apologize and provide current status

2. **Refund:** Apply delay-based credit per `refund-policy.md` (same tiers as restaurant delay)

3. **Driver flag:** Document the driver's performance issue:
   ```
   execute_action("AddTicketNote", {
     ticketId: "...",
     note: "DRIVER DELAY: DriverId {DriverId} — assigned at {DriverAssignedTime}, enroute at {EnrouteTime} (response time: N min). Transit time excessive. Flagging for review."
   })
   ```

4. **If driver is still mid-delivery:** Coordinate with Driver Comms to check on the driver's status rather than just flagging

### Cause D Resolution: System Issue

1. **Customer communication:** Apologize honestly -- "We're experiencing a system issue affecting deliveries in your area"
2. **Refund:** 50% of `OrderSubtotal` as credit (minimum)
3. **Escalate:** `request_clarification({ urgency: "high", category: "system_anomaly" })`
4. **Do not blame** any specific party when the cause is unclear

## Step 4: Calculate Refund Amount

Reference `refund-policy.md` for full details. Quick summary for late deliveries:

```
delay_minutes = calculated from Step 1

if (delay_minutes < 30):
  # Minor — store credit of 500 cents
  amount = 500
  type = "credit"

elif (delay_minutes >= 30 && delay_minutes < 45):
  amount = Math.round(OrderSubtotal * 0.25)
  type = "credit"  # prefer credit for moderate delays

elif (delay_minutes >= 45 && delay_minutes < 60):
  amount = Math.round(OrderSubtotal * 0.50)
  type = "refund"  # refund for significant delays

elif (delay_minutes >= 60):
  amount = Math.round(OrderSubtotal * 0.75)
  type = "refund"

# If order never delivered (OrderDeliveredTime is null AND delay > 60 min):
  amount = OrderTotal  # full refund including fees and tip
  type = "refund"
```

**Tier check:** If amount >= 2500 cents ($25.00), stage for human approval (RED tier). Otherwise, process as ORANGE tier.

## Step 5: Communicate with Customer

### Template: Order is Still In Progress (driver en route)

> "We're sorry your order from {RestaurantName} is taking longer than expected. Your driver {DriverFirstName} is on the way. We've added a ${amount/100} credit to your account for the wait."

### Template: No Driver Assigned

> "We sincerely apologize for the delay with your order from {RestaurantName}. We're working urgently to get a driver assigned. We'll update you as soon as we have an ETA, and we've applied a ${amount/100} credit to your account."

### Template: Restaurant Caused the Delay

> "We're sorry about the delay -- {RestaurantName} took longer than usual to prepare your order. Your food is now on its way. We've added a ${amount/100} credit to your account for the inconvenience."

### Template: Order Never Delivered (full refund)

> "We're very sorry -- your order from {RestaurantName} was not delivered within an acceptable timeframe. A full refund of ${OrderTotal/100} has been submitted and should appear on your statement within 3-5 business days."

## Step 6: Close the Ticket

1. Apply the financial remedy (refund or credit) per Step 4
2. Send the customer message per Step 5
3. Resolve the ticket:
   ```
   execute_action("ResolveTicket", {
     ticketId: "...",
     resolution: "Late delivery — {cause}. Delay: {N} minutes. {refund_type} of ${amount/100} issued. {additional_notes}"
   })
   ```

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `ResolveTicket` | YELLOW | Closing the ticket with full resolution notes |
| `AddTicketNote` | GREEN | Documenting investigation progress, restaurant/driver flags |
| `EscalateTicket` | GREEN | Issue beyond authority — safety, patterns, unclear cause |
| `IssueCredit` | ORANGE (< 2500) / RED (>= 2500) | Store credit for moderate delays |
| `IssueRefund` | ORANGE (< 2500) / RED (>= 2500) | Refund for severe delays or non-delivery |
| `SendCustomerMessage` | YELLOW | Communicating status update or resolution to customer |
| `request_clarification` | -- | Urgent driver reassignment, system anomaly, pattern escalation |

## Cooldown Rules

| Action | Minimum Wait | Max Attempts |
|--------|-------------|--------------|
| Customer message (same ticket) | 5 minutes | 3 |
| Resolve ticket | 0 (once) | 1 |
| Add note | 0 (immediate) | -- |

## Escalation

Escalate to supervisor if:
- No driver assigned and order is > 30 minutes old (urgent reassignment)
- Financial remedy >= 2500 cents (requires human approval)
- Customer has had 3+ late delivery tickets in the last 30 days (systemic issue)
- Restaurant shows a pattern of delays across multiple orders (health concern)
- Driver is unresponsive during an active late delivery (safety concern -- see `no-response-protocol.md`)
- You cannot determine the cause of the delay after investigation

## Logging

All actions are logged automatically by the ontology action layer. Ensure your `reasoning` string for each `execute_action` call includes: the cause identified, the delay duration, and the financial remedy applied.
