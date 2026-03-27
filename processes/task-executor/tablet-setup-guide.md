---
agent: task-executor
trigger: tablet_setup
priority: normal
version: "1.0"
---

# Tablet Setup Guide

**Trigger:** Restaurant needs help connecting or setting up their Valley Eats tablet.

**Check First:**
- Tablet model (restaurant page > change details > scroll to tablet model): Telpo TPS570 (old orange w/ printer), HAOQIN H7_US (old flat), SUNMI V2 (flat), iLeap/alps POSH5-OS01 (new orange w/ printer)

**Steps:**
1. **Setup (all models):** (a) connect to restaurant Wi-Fi, (b) set volume to max, enable "Use network-provided time" in Date & Time settings, verify time zone, (c) launch Valley Eats POS app, enter Restaurant ID (first 8 chars after /restaurant/ in App URL), (d) test order with VE team member: set hours to open, send test order, verify sound notification, decline with reason "test", set hours back to closed.
2. **Won't turn on:** check plugged in > try different outlet > hard reset (hold power 10+ sec). If dead, offer halt or call-in, create ticket for Growth to replace.
3. **Orders not showing:** check internet > send test message (restaurant don't touch tablet). If no endpoint: clear cache/data (Settings > Apps > VE App > Storage > Clear Cache > Clear Data), re-login with App URL.
4. **Network issues:** check other devices > restart modem/router > toggle Wi-Fi off/on > forget and reconnect network > restart tablet.
5. **Date/time wrong:** Settings > Date & Time > enable network time.
6. **Telpo TPS570 reset:** tap Telpo 6x > Operator 6x > Admin > password 654321 > Enter Android > clear cache/data.
7. **HAOQIN note:** after reset, ~25 apps appear; scroll down to find Valley Eats app.

**Escalate If:**
- Tablet needs replacement (ticket for Growth team)
- Setup failing despite all steps
- Multiple restaurants with connectivity issues (possible ISP problem)
