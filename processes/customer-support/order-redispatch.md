---
agent: customer-support
trigger: order_redispatch
priority: high
version: "1.0"
---

# Order Re-Dispatch

**Trigger:** Order was delivered but had a problem (missing items, wrong order, wrong address) and needs to be sent back out.

**Check First:**
- Customer wants food resent (not just a credit)
- Customer is available to receive it
- Restaurant is still open and makes the food
- Enough drivers available (inform customer of delay if needed)
- Order is marked "Completed" and from today's date

**Steps:**
1. **Before re-dispatch for wrong/missing items:** confirm order number on bag. Ask customer for photo of receipt and incorrect items. Confirm with restaurant they accept the charge (restaurant fault = they pay delivery fee).
2. Open order > Order Corrections > set resolution to "Re-Dispatch" > choose fault (courier/restaurant/Valley Eats) > describe what to prepare > enter remake cost if VE/courier fault > set pickup time (10 min if not busy) > select cause and error type > Save.
3. Verify re-dispatch appears on dispatch screen and is assigned to an active driver (original driver auto-assigned but may be off-shift).
4. After re-dispatch delivered, call customer to confirm everything is correct.
5. **Canceling a re-dispatch:** click green X > set status to "Completed" (ensures 1st courier gets paid). If restaurant needs remake payment, use "Valley Eats Owes Restaurant."

**Escalate If:**
- Re-dispatch involves significant cost beyond standard authority
- Restaurant cannot fulfill remake
- Customer requesting additional compensation beyond the re-dispatch
