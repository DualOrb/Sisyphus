---
agent: driver-comms
trigger: driver_app_issues
priority: normal
version: "1.0"
---

# Driver App Troubleshooting

**Trigger:** Courier reports app crashing, freezing, orders not displaying, GPS/navigation issues, or connectivity problems.

**Check First:**
- Driver fields: AppVersion, phoneModel, ConnectionId, Available, Paused
- Active orders for this courier
- Recent interactions

**Steps:**
1. **Orders not displaying:** most common cause is restaurant Wi-Fi auto-connecting and blocking data. Ask courier to turn off Wi-Fi, use mobile data. Then restart app. Send test message to verify.
2. **App crashing/freezing:** check AppVersion -- if outdated, ask to update. Otherwise: force close and reopen, restart phone, close other apps, check for updates.
3. **GPS/navigation issues:** verify address is correct. Provide coordinates and phone number for restaurant/customer. Use wego.here.com for HERE Maps address verification. If address genuinely invalid, escalate -- supervisor may need to contact customer. For device GPS issues: toggle location off/on.
4. **ConnectionId is null:** driver is offline. If they have active orders, flag to supervisor for potential reassignment immediately -- order cannot wait.
5. **General troubleshooting sequence:** (a) close/reopen app, (b) turn Wi-Fi off, ensure mobile data on, (c) update app, (d) restart phone, (e) close other apps. Send test message after each step.
6. **Multiple couriers reporting same issue simultaneously:** escalate as system anomaly (server-side problem).

**Escalate If:**
- Courier has active orders and cannot operate due to app failure
- App issue persists after full troubleshooting sequence
- Multiple couriers report same issue (system anomaly)
- GPS/address genuinely invalid -- supervisor needs to contact customer
- Courier offline with active orders and not reconnecting
