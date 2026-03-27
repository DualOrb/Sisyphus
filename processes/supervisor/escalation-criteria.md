---
agent: supervisor
trigger: escalation_check
priority: critical
version: "1.0"
---

# Escalation Criteria

**Trigger:** Any agent detects a situation requiring human involvement.

**Check First:**
- Confirm no human is already handling the issue (check timeline and open tickets)
- Verify the specific escalation threshold below is met

**Steps:**
1. **SAFETY** (critical, 30s) -- accident, injury, food safety, allergen, incapacitated driver, minor in distress. Do NOT attempt resolution; escalate immediately.
2. **FINANCIAL** (high, 2m) -- refund/credit/loss >= $25 (2500 cents), or multiple refunds to same customer >$50/24h. Complete investigation first, include recommendation, stage but do not execute.
3. **LEGAL/MEDIA** (critical, 1m) -- mention of lawyer, lawsuit, media threat, health department, police report. Stop all automated comms; do NOT apologize or admit fault.
4. **DRIVER SAFETY** (critical, 1m) -- 3+ unanswered follow-ups during active delivery, location stale 15+ min, driver reports distress/breakdown.
5. **SYSTEM ANOMALY** (high, 2m) -- action fails 3+ times, all drivers offline, multiple tablets offline, 3+ unassigned orders with 0 drivers, Score=100 across markets.
6. **OUTSIDE AUTHORITY** (normal, 5m) -- pay/scheduling policy, data privacy, account deletion, commission rates, HR matters. Acknowledge and escalate; do not guess on policy.

**Escalate If:**
- Any of the above thresholds are met
- Every escalation must include: category, urgency, entity IDs, 1-2 sentence summary, what you already checked, and your recommendation
