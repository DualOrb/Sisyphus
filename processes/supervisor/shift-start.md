---
agent: supervisor
trigger: shift_start
priority: critical
version: "1.0"
source: "Dispatch Analyst Guide — Start Of Shift Routine"
supplements: shift-start.md
---

# Start-of-Shift Checklist (Dispatch Analyst Guide Procedures)

This document captures the actual start-of-shift routine as defined in the Dispatch Analyst Guide. It supplements `shift-start.md` (which covers Sisyphus system-level startup) with the real-world human dispatcher procedures that Sisyphus must replicate or verify.

---

## Step 1: Log In to Dispatch Webpage

Open the dispatch webpage and confirm the UI is loaded. All market tabs, order tables, and map views must be accessible.

**Sisyphus equivalent:** Step 1 of `shift-start.md` — Verify System Connections (browser session, DynamoDB, Redis, PostgreSQL).

---

## Step 2: Sign In to Call Center

Sign into the call center even if you are not working a support shift. This is required to:

- Track metrics accurately
- Be ready if a call needs to be transferred to you

**Sisyphus equivalent:** Ensure the support/ticket subsystem is accessible and the agent is registered as available for escalation routing.

---

## Step 3: Clock In and Claim Markets

On the Settings page:

1. Clock in using the clock icon at the top center of the dispatch screen
2. Click the checkboxes for your assigned markets to "claim" them
3. Click "Select a Queue" and choose your name

This tells the system which markets you are responsible for and starts your shift timer.

**Sisyphus equivalent:** `execute_action("LogShiftEvent", { event: "shift_start" })` and activate market monitors for assigned zones.

---

## Step 4: Record Courier Information

After claiming your markets, record all couriers in each market in your notebook:

- Courier name / moniker (2-character identifier)
- Shift start time
- Shift end time

This helps you organize your couriers throughout the shift and track when they are leaving.

**Sisyphus equivalent:** Query `DriverShifts` via DynaClone and build the in-memory courier roster with shift windows for each market.

---

## Step 5: Message All Couriers

Send a hello message to all your couriers. Let them know:

- You are on shift
- You are available if they need anything

This establishes communication and confirms couriers are responsive.

**Sisyphus equivalent:** Automated shift-start greeting via the messaging system to all active couriers in claimed markets.

---

## Step 6: Check Outstanding Tickets

Open the Ticket Tracker and select your name to check for any tickets assigned to you.

- If tickets exist, you are responsible for their resolution — either resolve them yourself or hand them off to the appropriate department
- An orange circle with a number will appear at the top if any tickets are assigned to you

**Sisyphus equivalent:** Step 3 of `shift-start.md` — `query_tickets({ status: ["New", "Pending"] })` and prioritize unresolved items.

---

## Step 7: Check Discord Notes and Announcements

Log in to Discord and check:

- Notes for your specific markets (market-specific updates, restaurant closures, known issues)
- General announcements (company-wide changes, system updates, policy changes)

This ensures you are aware of any conditions that affect dispatching decisions for your shift.

**Sisyphus equivalent:** Step 2 of `shift-start.md` — Load Previous Shift Handoff. Discord notes are the human equivalent of the shift summary / handoff artifact.

---

## Quick Reference Checklist

- [ ] Log in to dispatch webpage
- [ ] Sign in to call center (even if not on support)
- [ ] Clock in on the Settings page
- [ ] Claim your assigned markets (check the boxes)
- [ ] Select your name in the queue
- [ ] Record all courier names, start times, and end times for each market
- [ ] Send a hello message to all couriers
- [ ] Open Ticket Tracker — check for tickets assigned to you
- [ ] Resolve or hand off any outstanding tickets
- [ ] Log in to Discord — read market notes and announcements
