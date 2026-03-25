---
agent: driver-comms
trigger: customer_not_responding_at_door
priority: normal
version: "1.0"
---

# Process: Customer Not Responding to Door

## Trigger

When a courier reports they have arrived at the delivery address and the customer is not answering the door, not coming out, or appears to not be home.

Common triggers:
- Courier messages: "Customer isn't answering the door," "No one is home," "Can't reach the customer"
- Courier has knocked/buzzed and waited with no response
- Courier has attempted to call the customer directly with no answer

## Prerequisites

Before responding, gather context:
- [ ] `get_order_details(orderId)` -- check `DeliveryType` ("Leave at door" vs. "Hand delivered"), `DeliveryInstructions`, `DeliveryStreet`
- [ ] Check `CustomerLocation` coordinates for the delivery location
- [ ] `query_drivers({ driverId })` -- confirm courier is at the delivery location
- [ ] `get_entity_timeline("driver", driverId, hours=1)` -- recent interactions
- [ ] Check if the order contains alcohol (`Alcohol` field)

**Key fields:**
- `DeliveryType` -- determines whether the order can be left at the door or must be handed to the customer
- `DeliveryInstructions` -- may contain alternate contact info, buzzer codes, or special instructions
- `Alcohol` -- if true, order cannot be left unattended under any circumstances

## Decision Tree

### Branch A: Delivery Type is "Leave at Door"

If `DeliveryType` is "Leave at door," the courier does not need to make direct contact with the customer.

1. Message the courier immediately:
   > "Hi {firstName}, this order is marked 'Leave at door.' Please leave it at the door and take a photo for confirmation. Thanks!"

2. The courier should:
   - Leave the order at the door
   - Take a photo showing the order at the door with the address/door number visible
   - Photo is attached to the order automatically

3. After the courier confirms delivery, notify the customer:
   > "Your order has been delivered and left at your door as requested."

**Done.** No further action required unless the customer later contacts ValleyEats about a missing order.

### Branch B: Delivery Type is "Hand Delivered" -- Customer Not Answering

#### Step 1: Message the Customer (Immediate)

Send a message to the customer from the current order:
> "Your courier is at your location with your order."

This is the first contact attempt. The customer may not have heard the knock or buzzer, or may be momentarily unavailable.

#### Step 2: Call the Customer (If No Response to Message)

If the customer does not respond to the message within 1-2 minutes:

1. **Call the customer** using the call center
   - Use the phone number on the order or customer profile
   - Some customers screen unknown numbers -- try calling twice
   - If the customer answers, confirm their location and relay any instructions to the courier

2. Message the courier while attempting contact:
   > "Thanks for trying, {firstName}. Please wait 5 minutes and try buzzing/knocking again. If the customer still doesn't answer, let me know and we'll handle it."

#### Step 3: Wait Period (5 Minutes)

The courier waits a total of **5 minutes** from the first contact attempt. During this time:
- The message has been sent
- The call has been attempted
- The courier has knocked/buzzed again

#### Step 4: Customer Still Not Responding After 5 Minutes

If the customer has not responded after 5 minutes of waiting, messaging, and calling:

1. Instruct the courier to leave the order at the door and take a photo:
   > "OK {firstName}, please leave the order at the door and we'll note that the customer was unreachable. You're good to go."

2. The courier must:
   - Leave the order at the door
   - Take a photo with the address/door number visible
   - The photo is attached to the order for our records

3. Notify the customer of the delivery:
   > "Your order has been left at your door. Our courier attempted to reach you but was unable to make contact. If you have any questions, please let us know."

4. Document: `execute_action("AddTicketNote", { note: "Courier {DriverId} arrived at {address}. Customer unresponsive after message, call attempt, and 5-minute wait. Order left at door with photo. DeliveryType was Hand Delivered." })`

### Branch C: Alcohol Orders -- Customer Not Answering

**Alcohol orders cannot be left unattended.** The courier must hand the order directly to the customer.

1. Follow Steps 1-3 above (message, call, 5-minute wait)
2. If the customer is still unreachable after 5 minutes:
   - **Do NOT instruct the courier to leave the order at the door**
   - Escalate to supervisor immediately: `request_clarification({ urgency: "high", category: "alcohol_delivery_unreachable", orderId, driverId, customerUnreachable: true })`
   - Message the courier:
     > "Hi {firstName}, this order contains alcohol so we can't leave it unattended. I'm escalating this now -- please hold tight."
3. The supervisor will determine next steps (e.g., return the order, cancel, extended wait)

## After Delivery -- Customer Contacts ValleyEats

When/if the customer contacts ValleyEats about the situation:

1. Explain what happened:
   > "Our courier arrived at your address and attempted to reach you by knocking and through our messaging system. After waiting, the order was left at your door and a photo was taken for confirmation."

2. If the customer claims the order was not received:
   - Check the photo attached to the order (located above the customer's address in the order modal)
   - Verify the delivery address matches
   - Follow the Wrong Address process if the photo shows an incorrect location
   - If the photo confirms correct delivery, work with the customer on a resolution per standard complaint procedures

## Response Templates

**To customer -- courier has arrived:**
> "Your courier is at your location with your order."

**To courier -- leave-at-door order:**
> "Hi {firstName}, this order is marked 'Leave at door.' Please leave it at the door and take a photo for confirmation. Thanks!"

**To courier -- wait for hand delivery:**
> "Thanks for trying, {firstName}. Please wait 5 minutes and try buzzing/knocking again. If the customer still doesn't answer, let me know and we'll handle it."

**To courier -- leave after wait:**
> "OK {firstName}, please leave the order at the door and we'll note that the customer was unreachable. You're good to go."

**To courier -- alcohol order hold:**
> "Hi {firstName}, this order contains alcohol so we can't leave it unattended. I'm escalating this now -- please hold tight."

**To customer -- post-delivery notification:**
> "Your order has been left at your door. Our courier attempted to reach you but was unable to make contact. If you have any questions, please let us know."

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `SendDriverMessage` | YELLOW | Instructing courier on wait time and leave-at-door |
| `SendCustomerMessage` | YELLOW | Notifying customer that courier has arrived or order was left |
| `AddTicketNote` | GREEN | Documenting unreachable customer and resolution |
| `EscalateTicket` | GREEN | Alcohol order with unreachable customer, safety concern |
| `request_clarification` | -- | Escalating to supervisor for alcohol or unresolvable situations |

## Cooldown Rules

| Action | Minimum Wait | Max Attempts |
|--------|-------------|--------------|
| Customer message | 0 (immediate) | 1 |
| Customer call | 1-2 minutes after message | 2 |
| Courier wait instruction | 0 (immediate) | 1 |
| Leave-at-door instruction | 5 minutes after first contact attempt | 1 |

## Escalation

Escalate to supervisor if:
- Alcohol order and customer is unreachable after 5 minutes
- Courier feels unsafe at the delivery location -- escalate immediately as SAFETY per `escalation-criteria.md`
- Customer is unreachable and the delivery address appears invalid or suspicious
- Customer later disputes the delivery and photo evidence is inconclusive
