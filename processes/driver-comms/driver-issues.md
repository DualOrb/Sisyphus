---
agent: driver-comms
trigger: driver_complaint
priority: normal
version: "1.0"
---

# Process: Handling Driver Complaints and Problems

## Trigger

When a driver sends a message reporting a problem, complaint, or requesting assistance -- and the issue is not specifically about an unconfirmed assignment (see `assignment-followup.md`) or a no-response situation (see `no-response-protocol.md`).

Common triggers:
- Driver messages about app or navigation problems
- Driver reports a restaurant is closed or has issues
- Driver cannot reach the customer at the delivery address
- Driver reports a personal issue affecting their shift
- Driver has a question about their schedule or assignments

## Prerequisites

Before responding, gather context:
- [ ] `query_drivers({ driverId: "{DriverId}" })` -- full driver record including `FullName`, `Phone`, `AppVersion`, `phoneModel`, `DispatchZone`, `ConnectionId`, `Available`, `Paused`
- [ ] `query_orders({ driverId: "{DriverId}", status: ["Confirmed", "Ready", "EnRoute", "InTransit"] })` -- driver's active orders
- [ ] `get_entity_timeline("driver", driverId, hours=2)` -- recent interactions
- [ ] `query_tickets({ driverId: "{DriverId}", status: ["New", "Pending"] })` -- any open tickets about this driver

**Key driver fields from `ValleyEats-Drivers`:**
- `AppVersion` -- the driver app version (useful for diagnosing app bugs)
- `phoneModel` -- the device model (useful for device-specific issues)
- `ConnectionId` -- WebSocket connection (null = offline)
- `Available` -- whether the driver is accepting orders
- `Paused` -- whether the driver is temporarily paused

## Decision Tree by Issue Type

### Issue 1: App Problems

**Examples:** "The app keeps crashing", "I can't see the order details", "My app is frozen", "Map isn't loading"

**Investigation:**
1. Check `AppVersion` -- is the driver on the latest version?
2. Check `phoneModel` -- is it a known problematic device?
3. Check `ConnectionId` -- is the driver currently connected?

**Response templates:**

If outdated app version:
> "Hi {firstName}, it looks like you're on version {AppVersion}. We recommend updating to the latest version — that should fix the issue. Let me know if it persists after updating."

If connected and app issue is minor:
> "Hi {firstName}, sorry about the app trouble. Try closing the app completely and reopening it. If that doesn't work, try restarting your phone. Let me know if the issue continues."

If connection is lost (`ConnectionId` is null):
> Driver is offline and may not receive the message. Log the issue and wait for them to reconnect. If they have an active order, flag to supervisor.

**When to escalate:**
- Driver has an active order and cannot see it due to app issues -- escalate to supervisor for potential reassignment
- App issue persists after troubleshooting -- escalate as a system issue
- Multiple drivers reporting the same app issue simultaneously -- escalate as a system anomaly

### Issue 2: Navigation Issues

**Examples:** "The address doesn't exist", "GPS is taking me to the wrong place", "I can't find the restaurant"

**Investigation:**
1. Get the relevant order via `get_order_details`
2. Check `DeliveryStreet`, `DeliveryCity`, `DeliveryProvince` for the customer delivery address
3. Check `OrderLocation` (`latitude`, `longitude`) for the restaurant coordinates
4. Check `CustomerLocation` (`latitude`, `longitude`) for the delivery coordinates

**Response templates:**

Restaurant navigation issue:
> "Hi {firstName}, the restaurant ({RestaurantName}) should be at {restaurant address from order}. If you're having trouble, here are the coordinates: {latitude}, {longitude}. Call the restaurant at {Restaurant.Phone} if needed."

Customer delivery issue:
> "Hi {firstName}, the delivery address is {DeliveryStreet}, {DeliveryCity}. Delivery instructions: {DeliveryInstructions or 'none provided'}. If you still can't find it, try calling the customer."

**When to escalate:**
- The address is genuinely invalid or unreachable -- escalate to supervisor, who may contact the customer
- Multiple drivers report the same address issue -- flag to Task Executor to update restaurant location

### Issue 3: Restaurant Closed

**Examples:** "The restaurant is closed", "Nobody is here", "Restaurant says they're not taking orders"

**Investigation:**
1. Check `Restaurant.LastHeartbeat` -- is the tablet online? (`now - LastHeartbeat < 300`)
2. Check `Restaurant.KitchenHours` -- is the restaurant supposed to be open? (Hours are in **minutes from midnight**, e.g., 660 = 11 AM)
3. Check for other orders at the same restaurant: `query_orders({ restaurantId, status: ["Pending", "Confirmed"] })`

**Response templates:**

Restaurant confirmed closed:
> "Thanks for letting us know, {firstName}. I'm looking into this and we'll get back to you shortly."

Restaurant should be open:
> "Thanks, {firstName}. The restaurant should be open right now. I'm flagging this for investigation. Hold tight — we may need to reassign the order."

**Actions:**
1. If the restaurant is supposed to be open but isn't:
   - Flag to supervisor: `request_clarification({ urgency: "high", category: "restaurant_closed", restaurantId, restaurantName, driverReport: "..." })`
   - Invoke Task Executor to pause the restaurant: the supervisor or Customer Support agent can call `execute_action("UpdateRestaurant", { restaurantId, field: "DeliveryAvailable", value: false })`
2. If the restaurant has active orders from other drivers, those orders are also affected
3. Document: `execute_action("AddTicketNote", { note: "Driver {DriverId} reports {RestaurantName} is closed. LastHeartbeat: {ts}. KitchenHours: {hours}." })`

**When to escalate:**
- Always escalate restaurant closures to the supervisor -- it affects all orders at that restaurant
- If the driver has an active order from the closed restaurant, that order needs reassignment or cancellation

### Issue 4: Customer Not Reachable

**Examples:** "Customer isn't answering the door", "No one is home", "Wrong address, nobody here", "Can't reach the customer by phone"

**Investigation:**
1. Get the order: `get_order_details(orderId)` -- check `DeliveryType` ("Leave at door" vs. "Hand delivered")
2. Check `DeliveryInstructions` for special notes from the customer
3. Check `CustomerLocation` for the delivery coordinates

**Response templates:**

If `DeliveryType` is "Leave at door":
> "Hi {firstName}, this order is marked 'Leave at door.' Please leave it at the door and take a photo for confirmation. Thanks!"

If `DeliveryType` is "Hand delivered" and customer is not answering:
> "Thanks for trying, {firstName}. Please wait 5 minutes and try buzzing/knocking again. If the customer still doesn't answer, let me know and we'll handle it."

If 5 minutes have passed:
> "OK {firstName}, please leave the order at the door and we'll note that the customer was unreachable. You're good to go."

**When to escalate:**
- Customer is unreachable AND the order has alcohol (`Alcohol: true`) -- the order cannot be left unattended. Escalate to supervisor.
- Driver feels unsafe at the delivery location -- escalate immediately as SAFETY per `escalation-criteria.md`

### Issue 5: General Complaints and Requests

**Examples:** "I want to take a break", "My pay seems wrong", "I don't want deliveries from that restaurant", "I need to end my shift early"

**Response templates:**

Break/pause request:
> "Of course, {firstName}. You can pause yourself in the app, or I can help. Just let me know when you're ready to go again."

Pay/scheduling question:
> "I understand, {firstName}. Pay and scheduling questions are best handled by the operations team. I'll pass this along so they can get back to you."

Restaurant avoidance:
> "Got it, {firstName}. I've noted your preference. For now, I can't change restaurant assignments, but I'll flag this for the team."

Shift change:
> "Thanks for letting me know, {firstName}. I'll pass this along to see what we can arrange."

**When to escalate:**
- All pay, scheduling, and policy questions: escalate to supervisor (Category 6: Outside Operating Authority)
- Driver is upset or frustrated: respond empathetically first, then escalate if you cannot resolve
- Driver threatening to quit or stop working mid-shift: escalate to supervisor

## General Response Rules

- Use the driver's first name (extract from `FullName` -- take the first word)
- Acknowledge the issue before providing solutions
- Keep messages under 160 characters when possible
- Maximum 2 messages before waiting for a driver response
- Never promise things outside your authority (pay changes, policy exceptions)
- Never blame the driver for system issues
- Never be accusatory or condescending

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `SendDriverMessage` | YELLOW | Responding to the driver's complaint or question |
| `AddTicketNote` | GREEN | Documenting the issue and investigation |
| `EscalateTicket` | GREEN | Issue beyond authority -- pay, policy, safety |
| `ReassignOrder` | YELLOW | Driver cannot complete delivery due to the reported issue |
| `request_clarification` | -- | Escalating to supervisor or requesting human help |

## Cooldown Rules

| Action | Minimum Wait | Max Attempts |
|--------|-------------|--------------|
| Reply to driver message | 0 (immediate OK) | -- |
| Follow-up (no response) | 5 minutes | 3 |
| Unsolicited check-in | 15 minutes | 1 |

## Escalation

Escalate to supervisor if:
- Any safety concern (driver feels unsafe, vehicle issue, weather hazard)
- Pay, scheduling, or policy questions (outside Sisyphus's authority)
- Restaurant closure affecting active orders
- App issue preventing a driver from completing an active delivery
- Customer unreachable on an alcohol order
- Driver threatening, abusive, or in distress
- Issue requires order cancellation or reassignment and the driver cannot confirm

## Logging

All actions are logged automatically by the ontology action layer. Ensure your `reasoning` string includes the issue type, driver details (AppVersion, phoneModel if relevant), and the resolution provided.
