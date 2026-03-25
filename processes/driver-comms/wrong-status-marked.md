---
agent: driver-comms
trigger: courier_marked_order_incorrectly
priority: normal
version: "1.0"
---

# Process: Courier Marked Order Incorrectly

## Trigger

When a courier has set the wrong status on an order, causing incorrect tracking information for the customer, restaurant, or dispatch.

Common triggers:
- Courier marked "At Restaurant" while still driving to the restaurant
- Courier marked "In Transit" before actually leaving the restaurant
- Courier marked order as delivered/completed prematurely
- Courier accidentally marked "En-Route" to the wrong restaurant
- Courier set "In Bag" before actually receiving the food
- Dispatch notices a status timestamp that does not match the courier's actual location or activity

## Prerequisites

Before taking action, gather context:
- [ ] `get_order_details(orderId)` -- check current `OrderStatus` and all timestamps: `EnrouteTime`, `AtRestaurantTime`, `PickedUpTime`, `InTransitTime`, `DeliveryTime`
- [ ] `query_drivers({ driverId })` -- courier's current location and status
- [ ] `query_orders({ driverId, status: ["Confirmed", "Ready", "EnRoute", "InTransit"] })` -- other active orders
- [ ] `get_entity_timeline("driver", driverId, hours=1)` -- recent activity

**Key status rules from the guide:**
- **En-Route**: Sends a notification to the restaurant with an ETA. Some restaurants (especially fast food) wait to start preparing until they receive this notification. Setting this status prevents the courier from selecting another order as En-Route unless it is to the same restaurant.
- **At Restaurant**: Should only be set when the courier is actually inside the restaurant waiting for food. If a courier marks "At Restaurant" more than 5 minutes before the pickup time, they need to be told not to arrive too early. If they are sitting outside waiting, this status must be cleared.
- **In Bag**: Triggers a "pending delivery" status for the customer if the order is not put In Transit within 5 minutes.
- **In Transit**: Lets the customer view the courier's live location. Multiple orders should NOT be in transit simultaneously if going to separate locations -- the customer will see the courier driving away from them.
- **Canceled**: Triggers an automatic refund and stops restaurant payment. Must NEVER be set without calling the restaurant first to confirm they have not started making the order.

## Step-by-Step Resolution

### Step 1: Identify the Incorrect Status

Compare the order's current status and timestamps against what should be happening:

| Situation | What's Wrong | Impact |
|-----------|-------------|--------|
| Courier marked "At Restaurant" but is still driving | Restaurant may think courier is waiting; timestamp is inaccurate for food quality tracking | Moderate |
| Courier marked "At Restaurant" 5+ min before pickup time | Courier arrived too early; status is misleading | Low |
| Courier marked "En-Route" to wrong restaurant | Wrong restaurant received an ETA notification; courier is blocked from marking En-Route to the correct restaurant | High |
| Courier marked "In Bag" before receiving food | Customer sees "pending delivery" prematurely; 5-minute In Transit countdown started | Moderate |
| Courier marked "In Transit" for multiple orders going different directions | Customer sees courier driving away from them | High |
| Courier marked order as completed prematurely | Order disappears from active tracking; courier pay may process | High |

### Step 2: Change the Order Status

**Change the order status** in the order modal to the correct status. Statuses can be changed inside the order by dispatch.

Specific corrections:

**Premature "At Restaurant":**
- Clear the "At Restaurant" status by clicking the green x on the order information section
- Message the courier:
  > "Hi {firstName}, I noticed the order was marked as 'At Restaurant' but it looks like you haven't arrived yet. Please only mark that status when you're actually inside the restaurant waiting for the food. Thanks!"

**Wrong "En-Route":**
- Clear the En-Route status by clicking the green x
- This unblocks the courier from selecting En-Route to the correct restaurant
- Message the courier:
  > "Hi {firstName}, it looks like that En-Route was set for the wrong restaurant. I've cleared it -- please mark En-Route when you're heading to {correct restaurant name}."

**Premature "In Bag":**
- If the food is not actually in the courier's bag, revert the status
- Note: reverting stops the 5-minute In Transit countdown for the customer
- Message the courier:
  > "Hi {firstName}, the order was marked as 'In Bag' but the restaurant hasn't handed it off yet. I've corrected the status. Please mark it once you actually have the food."

**Multiple orders "In Transit" to different locations:**
- Determine which order the courier is actively delivering to first
- Keep only that order as "In Transit"
- Revert the other order(s) to "In Bag" until the courier is actually heading to that delivery
- Message the courier:
  > "Hi {firstName}, just a heads-up -- please only put one order In Transit at a time when delivering to different addresses. The customer can see your location and it can cause confusion. Deliver to {closest address} first."

**Premature completion:**
- If the order was marked as completed but has not actually been delivered, change the status back to the appropriate active status
- Verify whether courier pay has already processed -- if so, escalate to supervisor

### Step 3: Communicate with the Courier

After correcting the status, always let the courier know what was changed and why. Keep the tone friendly and instructive, not accusatory:
- Acknowledge the mistake without blame
- Explain the impact (e.g., "the customer can see your location when it's in transit")
- Remind them of the correct usage

**General correction message:**
> "Hi {firstName}, I've updated the status on order #{orderId}. Just a quick reminder -- [specific guidance about the status]. No worries, just wanted to keep things accurate!"

### Step 4: Mitigate Customer Impact

If the incorrect status triggered a customer-facing notification:
- "En-Route" sent a restaurant notification with an incorrect ETA -- call the restaurant to provide the correct ETA
- "In Transit" showed the customer a courier location that was confusing -- message the customer:
  > "Your order is being prepared and will be on its way to you shortly. Thank you for your patience!"
- "Pending delivery" triggered prematurely from an early "In Bag" -- if the customer writes in, reassure them:
  > "Your order is on its way and will be put in transit shortly."

### Step 5: Document

`execute_action("AddTicketNote", { note: "Courier {DriverId} marked order #{orderId} as {wrongStatus} incorrectly. Corrected to {correctStatus}. Courier notified of correct usage. Customer impact: {description}." })`

## At-Restaurant Timing Rule

Per the guide: if a courier marks "At Restaurant" more than **5 minutes before the pickup time**, dispatch must reach out:
> "Hi {firstName}, I see you've marked as at the restaurant but the pickup time isn't for another {X} minutes. Please don't arrive too early -- it's better to time your arrival closer to the ready time. If you're just waiting outside, I'll clear the status for now."

Clear the "At Restaurant" status if the courier is only sitting outside and not actually inside waiting for the food.

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `SendDriverMessage` | YELLOW | Notifying courier of the correction and correct usage |
| `AddTicketNote` | GREEN | Documenting the incorrect status and correction |
| `SendCustomerMessage` | YELLOW | Mitigating confusion from incorrect customer-facing notifications |
| `SendRestaurantMessage` | YELLOW | Correcting ETA if wrong En-Route was sent |
| `EscalateTicket` | GREEN | Premature completion that may have triggered courier pay |
| `request_clarification` | -- | Supervisor help for pay or system issues from the wrong status |

## Cooldown Rules

| Action | Minimum Wait | Max Attempts |
|--------|-------------|--------------|
| Status correction | 0 (immediate) | 1 |
| Courier notification | 0 (immediate) | 1 |
| Customer clarification | Only if customer was impacted | 1 |

## Escalation

Escalate to supervisor if:
- Courier repeatedly marks orders incorrectly (pattern of behavior) -- create a courier ticket for driver relations
- Order was marked as completed/cancelled incorrectly and pay or refund has been processed
- Incorrect cancellation status was set -- automatic refund may have been triggered and restaurant payment stopped
- Status correction causes a system error or cannot be reverted through the order modal
