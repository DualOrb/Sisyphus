---
agent: customer-support
trigger: customer_search
priority: normal
version: "1.0"
---

# Customer Lookup

**Trigger:** Need to find or review a customer's profile and history.

**Check First:**
- Customer email address (primary identifier)

**Steps:**
1. Type email in search bar to open customer info screen.
2. **Key fields:** Stripe ID (if missing, click "Create" to fix checkout errors). App Version (should be 3.1.0+). Perks Points (do NOT modify without supervisor instruction). Convenience Free Orders (service fee credits).
3. **Service fee credits:** "No fees" button > enter count (negative to remove). Auto-applied at checkout.
4. **Payment methods:** visible top right. X to delete a card.
5. **Background section:** notes about previous problems (hard-to-find address, false reports). Check before any interaction.
6. **Addresses:** previous addresses listed. Click to edit, hit "Save Changes." Use to add delivery instructions for future orders.
7. **Orders:** all past orders. "In Progress" = items in cart, not yet placed. Green mail symbol = resend receipt.
8. **Delivery Instructions:** type and press Enter to update. After updating on active order, send ping/push to driver.
9. **Transaction History:** bottom of profile. Paper scroll icon = receipt. Always send screen snip as proof, never the receipt link.

**Escalate If:**
- Customer has no Stripe ID and creating one fails
- Suspicious patterns in Background notes
