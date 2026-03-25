---
agent: driver-comms
trigger: courier_will_be_late
priority: normal
version: "1.0"
---

# Process: Courier Will Be Late

## Trigger

When a courier reports they will be late to a restaurant pickup or to a customer delivery, or when dispatch detects a courier is behind schedule.

Common triggers:
- Courier messages: "I'm running late," "Traffic is bad," "I won't make it on time"
- Order approaching delivery time and courier is still at restaurant or in transit with delays
- Courier is delayed at a previous pickup or delivery
- Courier is making a long-distance trip in multiple directions

## Prerequisites

Before responding, gather context:
- [ ] `get_order_details(orderId)` -- check `ReadyTime`, `DeliveryTime`, `OrderStatus`, `PickedUpTime`, `AtRestaurantTime`
- [ ] `query_drivers({ driverId })` -- courier's current status and location
- [ ] `query_orders({ driverId, status: ["Confirmed", "Ready", "EnRoute", "InTransit"] })` -- all active orders for this courier
- [ ] Check if courier has bundled orders that may be causing the delay
- [ ] Note the `DeliveryTime` -- the system automatically adds 5 minutes to each order ETA to account for small delays

**Key time fields:**
- `ReadyTime` -- when the restaurant expects the order to be ready
- `DeliveryTime` -- estimated delivery time (includes automatic 5-minute buffer)
- `AtRestaurantTime` -- when courier marked as at restaurant
- `PickedUpTime` -- when food was picked up
- Expected travel time -- calculated from restaurant to customer

## Decision Tree

### Scenario A: Courier Late to Restaurant Pickup

The courier has not yet picked up the food and will arrive at the restaurant after the ready time.

#### Step 1: Assess the Delay

1. Determine how long the courier will be delayed
2. Check if the restaurant has already started preparing the order (status "Confirmed" or "Ready")
3. Check the courier's other active orders -- are they completing another delivery first?

#### Step 2: Communicate with the Restaurant

Message or call the restaurant with an updated ETA:
> "Our courier is delayed, should be there in {estimated_minutes}."

**Important timing considerations:**
- If the restaurant has not started preparing yet (e.g., fast food restaurants that wait for the En-Route notification), the delay may not matter -- the restaurant can start preparing when the courier is closer
- If the food is already ready and waiting, the delay affects food quality -- this is more urgent

#### Step 3: Adjust Ready Times if Possible

If the courier will be significantly delayed:
1. **Modify the order ready time** to align with the courier's realistic arrival
   - Adjust ready times for earlier rather than later when possible
   - Call the restaurant to confirm they can prepare the order for the adjusted time
   - Only modify if you have an accurate update from the restaurant and/or courier
2. If the delay is greater than 5 minutes between bundled orders, ask the restaurant to have orders ready for the same time to avoid a courier waiting with food in the bag

#### Step 4: Consider Rerouting

If the delay is significant (10+ minutes) and another courier is available:
1. Check for available couriers closer to the restaurant
2. Reroute the order if a better option exists: `execute_action("ReassignOrder", { orderId, newDriverId, reason: "Original courier delayed" })`
3. Notify the original courier if the order is reassigned:
   > "Hi {firstName}, we've moved order #{orderId} to another courier since you're running behind. No worries -- focus on your current delivery."

### Scenario B: Courier Late to Customer Delivery

The courier has the food but will be late delivering to the customer.

#### Step 1: Assess the Severity

Check the timestamps:
- If courier is still at a restaurant within **5 minutes of the estimated delivery time**, send a ping to the customer about the delay
- If the order is "In Bag" and approaching delivery time, the customer will see the ETA automatically updating
- A delay of **10+ minutes** past delivery time triggers a red status on the order -- this needs immediate attention

#### Step 2: Communicate with the Customer

**For moderate delays (order is on the way, just behind schedule):**
> "Our apologies for the delay, your order will be on its way shortly."

**For longer delays or if the customer writes in:**
> "We apologize for the delay with your delivery tonight. We are currently experiencing higher than normal volumes of orders, and unfortunately, there may be some delays. We always communicate with the restaurant to ensure your order is as fresh as possible for its arrival."

**If the order is "In Bag" but not yet "In Transit":**
> "Your order is on its way and will be put in transit shortly."

Do NOT put multiple orders in transit at the same time if they are going to separate locations -- the customer will see the courier driving away from them and wonder why.

#### Step 3: Manage the Courier's Route

If the courier has multiple orders:
1. Ensure the courier delivers the **closest orders first** to minimize delays
2. Check the courier's next pickup and reroute orders if needed to reduce potential delays
3. Have the courier leave the restaurant if another pickup is required elsewhere
4. Communicate the optimal route to the courier:
   > "Hi {firstName}, please deliver to {closest address} first, then head to {next address}."

#### Step 4: Handle Fallout from Significant Delays

For delays of 10-15+ minutes:
- Be prepared for customer complaints
- Service fee credits may be offered as immediate apology:
  - ~10-15 minutes late, food is fine: a few service fee credits ($5-$10)
  - 30+ minutes late: more significant refund, such as credit for a percentage of order total (check with supervisor)
- **Always confirm with a supervisor or manager before giving goodwill credits**
- Use the "Courier Running Behind" email template for written follow-up if needed

### Scenario C: Courier Delayed at Restaurant (10+ Minutes)

When a courier has been waiting at the restaurant for an extended period:

1. Communicate with the courier to get an accurate ready time from the restaurant
2. Notify customers of the delay
3. Check the courier's next pickup -- reroute other orders or adjust ready times to reduce cascading delays
4. If the courier has another pickup required elsewhere, have them leave the restaurant and come back, or reassign the waiting order to another courier
5. If the courier is still at the restaurant within 5 minutes of the delivery time, send a customer notification about the restaurant delay:
   > "We apologize for the delay. The restaurant is taking a bit longer than expected to prepare your order. Our courier is waiting there and will have it to you as soon as it's ready."

## Response Templates

**To restaurant -- courier delayed:**
> "Our courier is delayed, should be there in {estimated_minutes}."

**To customer -- general delay:**
> "Our apologies for the delay, your order will be on its way shortly."

**To customer -- high volume delay:**
> "We apologize for the delay with your delivery tonight. We are currently experiencing higher than normal volumes of orders. We always communicate with the restaurant to ensure your order is as fresh as possible."

**To customer -- restaurant delay:**
> "We apologize for the delay. The restaurant is taking a bit longer than expected. Our courier is there waiting and will have your order to you shortly."

**To customer -- order in bag, not yet in transit:**
> "Your order is on its way and will be put in transit shortly."

**To courier -- route guidance:**
> "Hi {firstName}, please deliver to {closest address} first, then head to {next address}."

**To courier -- order reassigned due to delay:**
> "Hi {firstName}, we've moved order #{orderId} to another courier since you're running behind. No worries -- focus on your current delivery."

### Email Template: Courier Running Behind

> Order: {orderId}
>
> Good Evening,
>
> We apologize for the delay with your delivery tonight.
>
> We are currently experiencing higher than normal volumes of orders, and unfortunately, there may be some delays.
>
> We always communicate with the restaurant to ensure your order is as fresh as possible for its arrival.
>
> As an apology from us, we have {RESOLUTION -- e.g., "added $X in service fee credits to your account"}.
>
> If you have any questions or concerns, please let us know and we would be happy to help.
>
> Best Regards,

### Email Template: Made a Wrong Turn

> Order: {orderId}
>
> Good Evening,
>
> We apologize for the lateness of your delivery tonight.
>
> Our driver is currently experiencing difficulties finding your address. I assure you, we are getting your order back on track, and we will have it out to you shortly.
>
> As an apology from us, we have {RESOLUTION}.
>
> If you have any questions or concerns, please let us know and we would be happy to help.
>
> Best Regards,

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `SendDriverMessage` | YELLOW | Communicating route instructions or reassignment info |
| `SendCustomerMessage` | YELLOW | Notifying customer of delay |
| `SendRestaurantMessage` | YELLOW | Updating restaurant on courier ETA |
| `AddTicketNote` | GREEN | Documenting the delay and actions taken |
| `ReassignOrder` | YELLOW | Rerouting order to a closer/available courier |
| `request_clarification` | -- | Escalating significant delays to supervisor |

## Cooldown Rules

| Action | Minimum Wait | Max Attempts |
|--------|-------------|--------------|
| Customer delay notification | 0 (immediate) | 1 per order per delay event |
| Restaurant ETA update | 0 (immediate) | Update again only if ETA changes |
| Courier route instruction | 0 (immediate) | -- |
| Follow-up with customer | After delivery is completed | 1 |

## Escalation

Escalate to supervisor if:
- Delay exceeds 30 minutes and requires significant compensation
- Multiple orders are cascading into delays due to courier shortage
- Customer is upset and requesting to speak with management
- Courier is unresponsive while orders are delayed
- Food quality is compromised and a re-dispatch may be needed -- confirm with supervisor before authorizing restaurant remake at Valley Eats cost
