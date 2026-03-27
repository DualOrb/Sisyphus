---
agent: task-executor
trigger: restaurant_tablet_issue
priority: high
version: "1.0"
---

# Restaurant Tablet Troubleshooting

**Trigger:** Restaurant reports tablet/connectivity issues, or Market Monitor detects stale LastHeartbeat.

**Check First:**
- Restaurant record: LastHeartbeat, tablet model (found on restaurant page -> change details)
- Active orders that may be affected
- Tablet model: Telpo TPS570 (old orange w/ printer), HAOQIN H7_US (old flat), SUNMI V2 (flat), iLeap/alps POSH5-OS01 (new orange w/ printer)

**Steps:**
1. **Won't turn on:** check if plugged in, try different outlet, hard reset (hold power 10+ sec). If still dead, offer restaurant choice: halt or call-in orders. Create ticket for Growth team to replace tablet.
2. **Orders not showing:** refresh app (top-right icon), power cycle tablet, verify internet. Send test message (tell restaurant not to touch tablet). If no endpoint: clear cache/data (Settings > Apps > Valley Eats > Storage > Clear Cache > Clear Data), then re-login with App URL (first 8 chars after /restaurant/).
3. **Network issues:** check other devices. Restart modem/router. Toggle Wi-Fi off/on. Forget and reconnect to network. Restart tablet. If nothing works, restaurant contacts ISP; offer halt or call-in.
4. **Date/time incorrect:** Settings > Date & Time > enable "Use network-provided time." Restart if needed.
5. **Telpo TPS570 reset:** tap Telpo 6x, Operator 6x, Admin, password 654321, Enter Android, then clear cache/data.
6. **HAOQIN note:** after reset, ~25 apps appear; scroll down to find Valley Eats app.
7. During any troubleshooting: offer to halt restaurant or call in orders as interim solution.

**Escalate If:**
- Tablet needs physical replacement (create ticket for Growth team)
- Persistent recurring tablet issues
- Multiple restaurants in same area report connectivity issues (possible ISP problem)
- Restaurant frustrated and troubleshooting not resolving issue
- New tablet setup failing despite following all steps
