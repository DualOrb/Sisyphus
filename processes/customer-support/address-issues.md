---
agent: customer-support
trigger: address_change_request
priority: high
version: "1.0"
---

# Address Issues

**Trigger:** Customer needs address changed on active order, wrong address delivered, or address cannot be found.

**Check First:**
- Current order details and delivery address
- Payment method (Apple Pay/Google Pay limits modifications)
- Whether order is already in transit

**Steps:**
1. **Changing address on active order:** Modify Order > input new address > click Geolocate and Calculate > write reason in Modify Notes > confirm pin is correct on map. If in transit, CALL the driver to confirm new address.
2. **If error during change:** try new browser tab. Check address on Google Maps / wego.here.com. If outside delivery zone, inform customer; offer to meet courier at zone edge. Try alternate town names (e.g., Smiths Falls area has Montague, Rideau Ferry, etc.). If new subdivision, find nearby working address.
3. **Apple Pay / Google Pay limitation:** cannot charge extra delivery fee through these methods. For Google Pay/Android Pay, Valley Eats absorbs the cost.
4. **After fixing:** update address in customer's account to prevent recurrence.
5. **Wrong address (already delivered):** call courier for exact drop location (photo attached to order). Call customer to check. If not found, offer re-dispatch: mark Driver Error only if 100% certain, request different driver, have them call customer on arrival and photo the delivery.
6. **Cross-market deliveries (red/blue background):** bundle as much as possible, plan return trips, max 3 in-bag orders.

**Escalate If:**
- Address cannot be resolved after all troubleshooting
- Re-dispatch needed for misdelivery
- Customer in new subdivision not in mapping system (supervisor may request map update)
