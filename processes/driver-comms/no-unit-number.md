---
agent: driver-comms
trigger: delivery_missing_unit_number
priority: normal
version: "1.0"
---

# Process: No Unit Number on Delivery Address

## Trigger

When a courier reports they have arrived at a delivery address but there is no unit or apartment number, or the delivery address is an apartment/condo building and the order lacks a unit number.

Common triggers:
- Courier messages: "There's no unit number," "Which apartment?", "I'm at the building but don't know where to go"
- Dispatch notices the delivery address is a multi-unit building with no unit specified
- Customer placed order with only a street address for an apartment complex

## Prerequisites

Before responding, gather context:
- [ ] `get_order_details(orderId)` -- check `DeliveryStreet`, `DeliveryCity`, `DeliveryInstructions`, `DeliveryType`
- [ ] Look up customer profile -- click on the customer's email address in the order
- [ ] Check the customer's **past orders** for a unit number previously used at the same address
- [ ] `query_drivers({ driverId })` -- confirm courier status and current location
- [ ] Check `CustomerLocation` coordinates to verify the building location

**Key fields to check:**
- `DeliveryInstructions` -- customer may have put the unit number here instead of the address field
- `DeliveryStreet` -- confirm the street address is correct
- Previous orders -- the customer may have included a unit number on a prior order to the same address

## Step-by-Step Resolution

### Step 1: Check Delivery Instructions and Past Orders

1. Open the order and review `DeliveryInstructions` -- the unit number may be embedded in the instructions rather than the address field
2. Click on the customer's email address in the order to open their profile
3. Check the **Orders section** for previous orders to the same street address
4. Look at previous `DeliveryStreet` entries and saved addresses under the **Address section** of the customer profile for a unit number

**If unit number is found in past orders or instructions:**
> "Hi {firstName}, the unit number is {unitNumber}. Head on up!"

- Update the current order's delivery instructions with the unit number for the courier
- Send a ping/push notification to the courier to ensure they see the update

### Step 2: Contact the Customer

If no unit number is found in past orders or delivery instructions:

1. **Message the customer from the current order:**
   > "Hi! Your courier has arrived at your building but we don't have a unit number on file. Could you please meet the courier at the front door/main entrance?"

2. **If no response within 2 minutes, call the customer** using the call center
   - Phone number is on the order or customer profile
   - Some customers may not answer unknown numbers; try twice if the first call is not picked up

3. **If the customer responds with a unit number:**
   - Update the delivery instructions on the order: type in the instruction and press Enter to update
   - **Send a ping or push notification to the driver** to ensure they notice the change
   - Message the courier:
     > "Hi {firstName}, the customer confirmed unit {unitNumber}. Thanks for waiting!"

### Step 3: Customer Unresponsive

If the customer does not respond to messages or calls:

1. Instruct the courier to **wait at the main entrance/front door** for up to 5 minutes
2. Message the courier:
   > "Hi {firstName}, we're trying to reach the customer now. Please wait at the main entrance -- they should be down shortly."

3. If after 5 minutes the customer is still unreachable:
   - Check `DeliveryType`:
     - **"Leave at door"**: Instruct courier to leave the order at the main entrance/lobby and take a photo with the address/door number visible
     - **"Hand delivered"**: Instruct courier to leave the order at the building's main entrance, take a photo, and move on
   - Message the courier:
     > "OK {firstName}, please leave the order at the main entrance and take a photo showing the address. You're good to go."
   - Notify the customer:
     > "Your order has been left at the main entrance of your building. Our courier was unable to reach you for a unit number. Please check the entrance."

### Step 4: Update Records

1. Add the unit number (if obtained) to the customer's saved address for future orders
   - Navigate to the Address section on the customer profile, click the address, add the unit number, and hit "Save Changes"
   - This ensures future orders include the unit number automatically
2. Add delivery instructions noting the building type for future reference
3. Document the interaction: `execute_action("AddTicketNote", { note: "Courier {DriverId} arrived at {address} -- no unit number on order. Resolution: {what happened}." })`

## Special Cases

### Alcohol Orders
If the order contains alcohol (`Alcohol: true`), the order **cannot** be left unattended. The courier must hand-deliver to the customer directly. If the customer cannot be reached and no unit number is available:
- Escalate to supervisor immediately
- Do NOT instruct the courier to leave the order at the door

### Gated Communities or Secure Buildings
If the building has a buzzer or gate code:
- Ask the customer for the buzzer/gate code along with the unit number
- Check `DeliveryInstructions` -- gate codes are sometimes included there
- If no code is available and the customer is unresponsive, instruct the courier to wait at the main entrance

## Response Templates

**To courier -- while investigating:**
> "Hi {firstName}, thanks for letting me know. I'm looking up the unit number now -- hold tight."

**To courier -- unit found:**
> "Hi {firstName}, the unit number is {unitNumber}. Head on up!"

**To customer -- requesting unit number:**
> "Hi! Your courier has arrived at your building but we don't have a unit number on file. Could you please meet the courier at the front door/main entrance?"

**To courier -- customer will meet at entrance:**
> "Hi {firstName}, the customer is coming down to the main entrance to meet you."

**To courier -- leave at door after wait:**
> "OK {firstName}, please leave the order at the main entrance and take a photo showing the address. You're good to go."

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `SendDriverMessage` | YELLOW | Communicating with the courier about unit number status |
| `SendCustomerMessage` | YELLOW | Asking customer for unit number or notifying of delivery |
| `AddTicketNote` | GREEN | Documenting the missing unit number and resolution |
| `EscalateTicket` | GREEN | Alcohol order with unreachable customer |
| `request_clarification` | -- | Escalating to supervisor when required |

## Cooldown Rules

| Action | Minimum Wait | Max Attempts |
|--------|-------------|--------------|
| Customer message | 0 (immediate) | 1 |
| Customer call | 2 minutes after message | 2 |
| Courier follow-up | 0 (immediate) | -- |
| Leave-at-door instruction | 5 minutes after first contact attempt | 1 |

## Escalation

Escalate to supervisor if:
- Alcohol order and customer is unreachable
- Courier feels unsafe at the delivery location
- Customer provides conflicting or suspicious address information
- Courier has been waiting more than 10 minutes with no resolution
