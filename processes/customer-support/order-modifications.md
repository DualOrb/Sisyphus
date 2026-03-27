---
agent: customer-support
trigger: order_modification_request
priority: high
version: "1.0"
---

# Order Modifications

**Trigger:** Customer or restaurant requests adding, removing, or substituting items on an active order.

**Check First:**
- Payment method (bottom of order, transaction section): Visa, Mastercard, Visa Debit, Credits = can add items. Apple Pay, Google Pay = CANNOT add items (removing/refunding still works).

**Steps:**
1. **Adding items:** Modify Cart > browse menu > select item > Order Details > click all "Calculate" options > Place Order. Confirm extra charges with customer. Call restaurant to notify of addition. Document in ticket.
2. **Removing items:** confirm exactly which items. Call restaurant -- if already prepared, try not to remove. Click X beside item > Submit > Calculate > Place Order. Confirm with customer.
3. **Restaurant out of stock:** ask restaurant for substitutions. Call customer with options. If sub costs more, adjust via Modify Order. If costs less, recalculate. If customer unreachable, write info in Dispatcher Notes and ping them. If ready time arrives with no response: similar item (smaller size) = generally OK to send. Completely different item = refund instead.
4. Notify customer of outcome. Document all changes in ticket and dispatcher notes.

**Escalate If:**
- Payment method prevents needed modification and no workaround
- Customer unreachable and substitution decision is unclear
- Multiple items need complex changes
