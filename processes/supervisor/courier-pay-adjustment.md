---
agent: supervisor
trigger: pay_adjustment_needed
priority: normal
version: "1.0"
---

# Courier Pay Adjustment

**Trigger:** Need to add a top-up to a courier's order pay for cross-market deliveries.

**Check First:**
- Order is completed/delivered (top-ups must NOT be added before completion)
- Delivery route matches an eligible top-up scenario

**Steps:**
1. **How to add:** open order > click Delivery Adjustments > enter top-up amount.
2. **Eligible routes (all $4.50 = $4.00 + $0.50 gas):**
   - Carleton Place driver: Almonte restaurant to Almonte address (not CP-to-Almonte, not Almonte-to-CP)
   - Embrun driver: Casselman restaurant to Casselman address (not Embrun-to-Casselman, not Casselman-to-Embrun)
   - CP or Perth driver: Law & Orders Innisville to Perth address (not to Carleton Place)
3. **3-or-more rule:** if courier gets 3+ consecutive orders in the remote town while already there, they lose top-up eligibility (they are effectively working that market, not making a special trip).
4. **Pay questions from couriers:** explain structure ($4.50 base for first 5 km, $0.61/km after, 100% tip). If they believe there is a discrepancy, direct to relations@valleyeats.ca. If they refuse an order for pay, ask politely; if they still refuse, move order and ticket relations.

**Escalate If:**
- Unclear whether a route qualifies for top-up
- Courier disputing pay beyond your ability to explain
