---
agent: supervisor
trigger: shift_end
priority: critical
version: "1.0"
source: "Dispatch Analyst Guide — End of Shift Routine"
supplements: shift-end.md
---

# End-of-Shift Checklist (Dispatch Analyst Guide Procedures)

This document captures the actual end-of-shift routine as defined in the Dispatch Analyst Guide. It supplements `shift-end.md` (which covers Sisyphus system-level shutdown) with the real-world human dispatcher procedures that Sisyphus must replicate or verify.

---

## Purpose

Ensure a smooth transition between your shift and the next dispatcher coming on. Nothing should fall through the cracks.

---

## Step 1: Go Offline in Ticket Tracker

Set yourself to "Offline" in the Ticket Tracker and log out. This ensures:

- No calls will be routed to you while you are off shift
- You are not holding up the support queue

**Sisyphus equivalent:** Deregister from the escalation routing system so no new tickets are assigned.

---

## Step 2: Complete or Reassign Outstanding Tickets

For each open ticket assigned to you:

**If completable now:** Resolve it before ending your shift.

**If not completable now:**
1. Assign the ticket to the next available support person on shift
2. Include all relevant information so they can continue working on the issue
3. Notify the customer that we will reach out to them when we can regarding their issue

Do not leave orphaned tickets with no assignee.

**Sisyphus equivalent:** Step 1 of `shift-end.md` — Complete or Hand Off In-Progress Tasks. Add handoff notes via `execute_action("AddTicketNote")` for anything that cannot be finished.

---

## Step 3: Send Goodnight Messages to Couriers

Send a goodnight text to all your couriers. These messages should:

- Always be positive
- Let them know their work is appreciated

This maintains the relationship with couriers and ends the shift on a good note.

**Sisyphus equivalent:** Automated end-of-shift thank-you message to all couriers who were active during the shift.

---

## Step 4: Shift Handoff Meeting

Meet with the person swapping off with you (the incoming dispatcher) and pass on:

- Any relevant and important information
- Current state of each market (delays, driver coverage, problem restaurants)
- Ongoing issues that need monitoring
- Anything that will help ensure success for the next shift

**Sisyphus equivalent:** Steps 2-3 of `shift-end.md` — Generate Shift Summary and Flag Unresolved Items. The shift summary artifact stored in `ValleyEats-SisyphusShiftSummary` serves as the handoff document.

---

## Step 5: Clock Out

Clock out the same way you clocked in (via the clock icon on the dispatch screen).

If you forget to clock in, clock out, or clock in/out for your break, notify your manager (Melissa) to correct it.

**Sisyphus equivalent:** `execute_action("LogShiftEvent", { event: "shift_end" })`.

---

## Step 6: Secure the Office

Follow any end-of-shift routines given by your manager for:

- Leaving the office
- Locking up
- Following proper protocols

**Sisyphus equivalent:** Step 5 of `shift-end.md` — Graceful Shutdown (stop polling loops, release Redis locks, log final confirmation).

---

## Quick Reference Checklist

- [ ] Set yourself to "Offline" in Ticket Tracker and log out
- [ ] Complete any outstanding tickets you can finish now
- [ ] Reassign remaining tickets to the next support person — include full context
- [ ] Notify affected customers that we will follow up
- [ ] Send a positive goodnight message to all your couriers
- [ ] Meet with the incoming dispatcher — hand off all relevant info
- [ ] Clock out on the dispatch screen
- [ ] Follow office closing procedures (lock up, etc.)
