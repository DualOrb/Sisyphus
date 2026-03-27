---
agent: task-executor
trigger: restaurant_hours_change_request
priority: normal
version: "1.0"
---

# Restaurant Hours Adjustment

**Trigger:** Restaurant requests a change to operating hours (one-time or permanent), or proactive adjustment needed.

**Check First:**
- Current KitchenHours and DefaultHours (stored as minutes from midnight: 660 = 11:00 AM)
- Recent hours changes to avoid conflicts
- Active orders that may fall outside new hours

**Steps:**
1. **Ask the restaurant two critical questions:** (a) Is this one-time or permanent? (b) Does the restaurant have split hours (morning/close/dinner)?
2. **Split hours: DO NOT TOUCH.** Create ticket for technical team. Halt restaurant if needed in the meantime.
3. **One-time change:** use Holiday Hours in Vendor Portal (auto-reverts next day). If closing early and close to normal close time, a halt may be simpler (confirm with restaurant).
4. **Permanent change:** update hours per day in Vendor Portal, click "Update Hours," refresh to verify. Create note for Restaurant Relations Coordinator.
5. **Validation:** open time must be before close time. Verify AM/PM. Check for active orders scheduled after new close time -- if affected, coordinate with restaurant or escalate.
6. Always refresh Vendor Portal page after saving to confirm change took effect.

**Escalate If:**
- Restaurant has split hours (technical team must handle)
- Active orders would be affected by the hours change
- Hours change source cannot be verified
- Unusual hours requested (24/7 or extremely limited)
