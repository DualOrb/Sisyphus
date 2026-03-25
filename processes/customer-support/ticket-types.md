---
agent: customer-support
trigger: ticket_classification
priority: normal
version: "1.0"
---

# Ticket Types Reference

All ticket types used in the Valley Eats ticket tracker, extracted from the Dispatch Analyst Guide.

---

## Payment Issue Ticket

A customer reports an unknown charge from Valley Eats or is having difficulty completing payment on their order.

**When it appears:** Customer-submitted.

**What to do:**
- Walk the customer through identifying the charge and explain it.
- Help adjust cards on file if needed.
- If the ticket involves possible fraud or stolen card information, assign it to a supervisor immediately. Do not attempt to resolve fraud cases yourself.

---

## Missing or Incorrect Item Ticket

A customer reports that an item is missing from their order or that they received an incorrect item.

**When it appears:** Customer-submitted.

**What to do:**
- Ask the customer if they received a copy of the receipt from the restaurant.
- Speak to the driver and the restaurant about the missing/incorrect item.
- Determine who is at fault (restaurant or courier).
- If the restaurant forgot the item: ask the restaurant if we can provide a resend or credit (whichever the customer prefers).
- If the missing item is because of us (courier error): provide a credit or resend directly.

---

## Unresponsive Driver Ticket

The system automatically generates this ticket when a driver is not confirming orders. The system automatically pauses the driver.

**When it appears:** System-generated (automatic).

**What to do:**
- Message the driver to let them know they have been paused and ask if they are still available to deliver.
- If the driver does not respond to the message after 10 minutes, call them.
- If they say they are available and just did not see the order, unpause them.
- If they do not answer and remain paused, the system will automatically end/remove the rest of the driver's shift after approximately one hour.

### Unresponsive Only Driver Ticket (Urgent Variant)

This means the only driver in that market is not confirming orders.

**When it appears:** System-generated (automatic). Flagged as very urgent.

**What to do:**
- Message and call the driver immediately.
- The priority is keeping orders on time and preventing cancellations.
- If the driver does not respond, find a replacement courier as fast as possible.

---

## Drop Shift Ticket

The system automatically generates this ticket when a courier has dropped their shift. The ticket includes the courier's information, shift start/end times, date, and location.

**When it appears:** System-generated (automatic) when a courier drops a shift.

**What to do:**
- **Monday-Friday, 8am-4pm:** Assign the ticket to Driver Relations / relations@valleyeats.ca.
- **Outside those hours (evenings, weekends):** You are responsible for finding a replacement and ensuring the market is covered. Send a push notification to available couriers in that market if needed.

---

## Driver Issue: Other Ticket

Most commonly, a courier wanting to adjust the start or end time on one of their shifts.

**When it appears:** Courier-submitted or system-generated.

**What to do:**
- **Monday-Friday, 8am-4pm:** Assign to Driver Relations.
- **Outside those hours:** You must adjust the shift yourself and find coverage for any uncovered hours.
  - Example: If a courier is working 4-9 but asks to adjust to 4-7, find coverage for 7-9.
- If a driver wants extended hours or completely different times, check if availability is open.
  - If no availability, explain this to the driver.
  - If they cannot work their original shift, ask them to drop or explain we cannot extend at this time.

---

## Incorrect Order Ticket

A customer reports receiving the wrong order entirely.

**When it appears:** Customer-submitted.

**What to do:**
- Determine who is at fault:
  - **Restaurant's fault:** The restaurant sent out the wrong order. Call them, explain the situation, and ask for a resend or credit (customer's preference).
  - **Courier's fault:** The courier delivered the wrong order (e.g., swapped bags in a bundle). Call the driver immediately — if they still have the correct order in their bag, have them deliver it to prevent further misdeliveries. Provide a credit or resend for the affected customer.

---

## Change Delivery Details Ticket

A customer wants to adjust their delivery address or delivery instructions after placing the order.

**When it appears:** Customer-submitted.

**What to do:**
- Open the order and enter new delivery instructions, or open "Modify Order" to adjust the address.
- Notify the driver immediately.
- Confirm the change with the customer.

---

## Restaurant Confirmation Ticket

A restaurant has not confirmed an order.

**When it appears:** System-generated (automatic).

**What to do:**
- Call the restaurant immediately and let them know an order is awaiting their confirmation.
- If it is a larger order and close to ready time, offer a time extension to the restaurant.
- Assign this ticket to yourself when it comes in.
- The system will automatically close the ticket once the restaurant confirms the order.

---

## Restaurant Call Back Ticket

A restaurant has requested a call back from dispatch.

**When it appears:** Restaurant-submitted through the system.

**What to do:**
- The ticket provides the restaurant's name, location, and phone number.
- Call them back as soon as possible.
- Help them with any questions or concerns they have.

---

## Excessive Delay Ticket

An order is delayed being picked up by 20-30 minutes.

**When it appears:** System-generated (automatic).

**What to do:**
- Find out why the order is delayed.
- Make sure the customer is notified of the delay.
- If delayed because of a courier, notify the restaurant as well.
- Determine if there is anything you can do to get the order in transit as soon as possible.

---

## Substitution Ticket

A restaurant needs to substitute an item on an order because the original item is unavailable.

**When it appears:** Restaurant-submitted or dispatcher-created.

**What to do:**
- Work with the restaurant to identify possible substitutions.
- Contact the customer to confirm they accept the substitution.
- Adjust the order in the system if needed.

---

## Dev Team Tickets

Tickets related to technical issues that require development team attention.

**When it appears:** Created by dispatchers or supervisors when a technical issue is identified that cannot be resolved at the support level.

**What to do:**
- Assign directly to the dev team. Do not attempt to resolve these yourself.

---

## Notes

- These are the most common ticket types. Other ticket types may appear; handle them based on context and escalate to a supervisor if unsure.
- Every step of solving a problem must be noted in the ticket. Write notes in between waits (e.g., while waiting for a customer to pick up the phone).
- If a ticket comes in without an order number, find it by clicking the customer's email address to open their customer page and locating the relevant order from that date.
