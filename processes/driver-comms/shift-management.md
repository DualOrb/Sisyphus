---
agent: driver-comms
trigger: shift_change_request
priority: normal
type: reference
domain: courier-shift-management
version: "1.0"
source: "Dispatch Analyst Guide — How/when to drop a shift"
---

# Courier Shift Management

**Trigger:** Courier wants to drop/adjust their shift, or coverage gap detected.

**Check First:**
- Couriers are independent contractors -- they have complete control over their schedule
- Current market coverage for the affected time window

**Steps:**
1. **Dropping shifts:** you may drop any time of day. You CAN ask if they mind doing an hour or two if busy. If they refuse, that is the end of it -- do not push further.
2. **When too many shifts dropped:** (a) send driver push notification for the market (SNS for moderate, SMS for urgent). (b) Ask couriers finishing shifts to stay longer. (c) Wait 15-20 min for response. (d) Contact courier relations team.
3. **Push notifications:** driver page > Message > select drivers/market > SNS (app only) or SMS (phone number). Urgent SMS: "URGENT! We are urgently looking for a driver to hop on in [market]. If you are available please reach out to dispatch!"
4. **Shift start:** message all couriers to open communication. **Shift end:** thank couriers for their work.
5. **Investigating dropped shift tickets:** read ticket details, parse shift time, check if already handled, query scheduled shifts for that window. 3+ other drivers = no gap. 0 other drivers = COVERAGE GAP, escalate and push for open shifts. Check the FUTURE time of the dropped shift, not current time.
6. **On-call:** couriers without shifts can toggle on-call to pick up deliveries or start early/stay late.
7. **Payout:** weekly (Sat-Fri), paid following Friday. Questions = relations@valleyeats.ca.

**Escalate If:**
- Coverage gap with no available drivers
- Cannot find replacement after push and 15-20 min wait
