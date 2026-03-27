---
agent: customer-support
trigger: ticket_classification
priority: normal
version: "1.0"
---

# Ticket Types Reference

**Trigger:** Need to identify or handle a specific ticket type.

**Check First:**
- Ticket type and whether it is customer-submitted, system-generated, or restaurant-submitted

**Steps:**
1. **Payment Issue** (customer): walk through identifying the charge. If fraud/stolen card, assign to supervisor immediately.
2. **Missing or Incorrect Item** (customer): confirm order number on bag, speak to driver and restaurant, determine fault, offer credit or resend.
3. **Unresponsive Driver** (system-generated): system auto-pauses driver. Message driver, if no response in 10 min call them. If available, unpause. If no answer, system removes shift after ~1 hour. **Unresponsive ONLY Driver** variant = extremely urgent, message and call immediately.
4. **Drop Shift** (system-generated): Mon-Fri 8-4 = assign to Driver Relations. Otherwise, you find replacement.
5. **Driver Issue: Other** (courier/system): usually shift time adjustment. Mon-Fri 8-4 = Driver Relations. Otherwise, adjust shift yourself and find coverage for any gaps.
6. **Incorrect Order** (customer): determine fault (restaurant packed wrong vs courier swapped bags). Credit or resend per fault.
7. **Change Delivery Details** (customer): modify order address/instructions, notify driver immediately.
8. **Restaurant Confirmation** (system-generated): call restaurant to confirm. Offer time extension for large orders. Auto-closes when confirmed.
9. **Restaurant Call Back** (restaurant): call them back ASAP, help with their questions/concerns.
10. **Excessive Delay** (system-generated): order delayed 20-30 min at pickup. Find out why, notify customer, get order moving.
11. **Substitution** (restaurant/dispatcher): work with restaurant on options, contact customer to confirm, adjust order.
12. **Dev Team** (dispatcher/supervisor): assign directly to dev team, do not attempt to resolve.

**Escalate If:**
- Fraud or stolen card (supervisor immediately)
- Cannot determine resolution for any ticket type (supervisor)
