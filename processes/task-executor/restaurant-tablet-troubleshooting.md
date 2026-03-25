---
agent: task-executor
trigger: restaurant_tablet_issue
priority: high
version: "1.0"
---

# Process: Restaurant Tablet Troubleshooting

## Trigger

When a restaurant reports tablet, network, or connectivity issues that prevent them from receiving or confirming orders. The Task Executor handles troubleshooting as a shared utility.

Common triggers:
- Restaurant calls reporting tablet issues (won't turn on, orders not showing, connectivity problems)
- Market Monitor detects stale `LastHeartbeat` indicating tablet is offline
- Orders are going unconfirmed and the root cause is suspected to be a tablet issue
- Restaurant reports incorrect date/time on their tablet
- New tablet setup assistance needed

## Prerequisites

Before troubleshooting, gather the current state:
- [ ] `query_restaurants({ restaurantId: "{RestaurantId}" })` -- restaurant record including `RestaurantName`, `Phone`, `LastHeartbeat`, tablet model info
- [ ] `get_entity_timeline("restaurant", restaurantId, hours=4)` -- check for recent connectivity events
- [ ] `query_orders({ restaurantId, status: ["Pending", "Confirmed"] })` -- check for active orders that may be affected

**Critical first step:** Always check the tablet version/model before helping a restaurant. Located on the restaurant page -> click on restaurant -> restaurant pages -> change details -> scroll down to tablet model.

## Tablet Versions

| Model | Description |
|-------|-------------|
| **Telpo TPS570** | Older tablet, orange with printer |
| **HAOQIN H7_US** | Older flat tablet, without printer |
| **SUNMI V2** | Flat tablet |
| **iLeap (alps POSH5-OS01)** | Newer orange tablet with printer |

## Troubleshooting Decision Tree

```
START: What is the problem?
│
├── Tablet won't turn on ──────────────── Go to: SECTION A
├── Orders not showing on tablet ──────── Go to: SECTION B
├── Network/Internet issues ───────────── Go to: SECTION C
├── Date & Time incorrect ─────────────── Go to: SECTION D
├── Need full tablet reset ────────────── Go to: SECTION E
└── New tablet setup ──────────────────── Go to: SECTION F
```

---

## SECTION A: Tablet Won't Turn On

**Source:** Dispatch Analyst Guide -- Resetting Flat Tablet and iLeap Tablet.

### Step 1: Check power connection
- Ask the restaurant: "Is the tablet plugged in?"
- If no: have them plug it in and wait for it to power on

### Step 2: Try another outlet
- If it is plugged in and still won't turn on: "Can you try plugging it into a different outlet?"

### Step 3: Hard reset attempt
- **For Telpo TPS570 (old tablet):** Hold the power button for 10+ seconds
- **For all other tablets:** Hold the power button to attempt a restart

### Step 4: If tablet still won't turn on
The tablet most likely needs replacement. At this point:

1. Ask the restaurant: "Would you like us to halt your restaurant, or would you prefer we call in your orders to you?"
2. Based on their preference:
   - **If halt:** Follow `restaurant-halting.md`
   - **If call-in:** Orders will be relayed to the restaurant verbally by phone -- note this in the system
3. Create a ticket for the Growth/Restaurant team to replace the tablet:
```
execute_action("CreateTicket", {
  category: "Tablet Replacement",
  assignTo: "growth@valleyeats.ca",
  restaurantId: "...",
  description: "Tablet for [RestaurantName] will not power on. Tried: plugging in, alternate outlet, hard reset. Tablet model: [model]. Restaurant is currently [halted / receiving call-in orders].",
  reason: "Tablet unresponsive - needs replacement"
})
```

---

## SECTION B: Orders Not Showing on Tablet

**Source:** Dispatch Analyst Guide -- Orders Don't Show.

### Step 1: Refresh the app
- Ask the restaurant to press the **refresh icon** in the top right corner of the Valley Eats app

### Step 2: Power cycle the tablet
- If refresh doesn't work: "Please hold the power button to restart the tablet"
- Wait for it to reboot and check if orders appear

### Step 3: Verify internet connection
- Ask: "Is your internet connected? Can you check if other devices in the restaurant can access the internet?"
- If internet is down: Go to **SECTION C**

### Step 4: Send a test message
- If the restaurant says internet is connected, send them a test message from the restaurant portal
- **Tell them not to touch the tablet while you send the message**
- If the message comes through: the tablet is working and internet is connected -- the issue may have been temporary
- If the message does NOT come through: there is no endpoint connection -- proceed to Step 5

### Step 5: Clear app cache and data (no endpoint)
This fix works for: **HAOQIN H7_US (older flat tablet)** and **SUNMI V2**

Walk the restaurant through these steps:
1. Go to **Settings**
2. Tap **Apps**
3. Find and tap the **Valley Eats App**
4. Tap **Storage**
5. Tap **Clear Cache**
6. Tap **Clear Data**
7. Tap **Delete app data** (press OK to confirm)
8. Press the **middle circle** (home button) at the bottom of the tablet
9. Go back to the **Valley Eats app** to log back in

### Step 6: Re-login after cache clear
After clearing data, the restaurant will need the **App URL** to log back in:
- The login ID is the first **8 alphanumeric characters** after `/restaurant/` in the restaurant's App URL
- Format: `restaurant/________` (only the first 8 characters)
- This can be found on the restaurant's page in the dispatch system

---

## SECTION C: Network / Internet Issues

**Source:** Dispatch Analyst Guide -- Network/Internet Issues.

Follow this sequence in order:

### Step 1: Check other devices
- Ask: "Are other devices in the restaurant connected to the internet?"
- If **no other devices have internet**: their internet service is likely down -- proceed to Step 2
- If **other devices work fine**: skip to Step 3

### Step 2: Restart the modem/router
- Ask the restaurant to locate their modem/router and restart it (unplug, wait 30 seconds, plug back in)
- Wait 2-3 minutes for it to reconnect
- Check if the tablet connects

### Step 3: Toggle Wi-Fi on the tablet
- Turn Wi-Fi **off** on the tablet, wait 10 seconds, turn it back **on**

### Step 4: Forget and reconnect to network
- Go to Wi-Fi settings on the tablet
- Tap on the connected network
- Select **"Forget Network"**
- Reconnect to the network by selecting it again and entering the Wi-Fi password

### Step 5: Restart the tablet
- If the above steps don't work, hold the power button and restart the tablet
- After reboot, check if it connects to Wi-Fi and receives orders

### If nothing works:
- The restaurant may need to contact their internet service provider
- In the meantime, offer to halt or call in orders (same as Section A, Step 4)
- Create a ticket documenting the connectivity issue

---

## SECTION D: Date & Time Incorrect

**Source:** Dispatch Analyst Guide -- Date & Time Incorrect.

Incorrect date/time on the tablet can cause order confirmations to appear inaccurate or orders to not display correctly.

Walk the restaurant through these steps:
1. Navigate to **Settings**
2. Tap the **Date & Time** icon
3. Make sure **"Set to network's time zone"** (or "Use network-provided time") is **enabled**
4. Reconfirm that the date and time now display correctly

If the time still doesn't correct after enabling network time:
- Manually set the correct time zone for the restaurant's location
- Restart the tablet
- If the issue persists, it may indicate a deeper system issue -- create a ticket

---

## SECTION E: Full Tablet Reset

Use when basic troubleshooting (Sections A-D) fails and the tablet needs a complete reset.

### Resetting Flat Tablet (HAOQIN H7_US) and iLeap Tablet

Follow the cache/data clear process in Section B, Step 5.

### Resetting Old Tablet -- Telpo TPS570 (orange with printer)

**Source:** Dispatch Analyst Guide -- Resetting Old Tablet.

This requires a special admin access sequence:
1. Tap **"Telpo"** 6 times
2. Tap **"Operator"** 6 times
3. Tap **"Admin"**
4. Enter password: **654321**, then tap **"Log In"**
5. Tap **"Enter Android"**
6. Tap the **3 dots menu** -> **Settings** -> **Apps** -> **Valley Eats app** -> **Storage** -> **Clear Cache** -> **Clear Data**

### HAOQIN-Specific Note

The HAOQIN flat tablet won't show the Valley Eats app right away after entering Android. It will display approximately 25 apps. Scroll down to find the Valley Eats app, then continue with the reset process (clear cache -> clear data).

### After Any Full Reset

The restaurant will need to log back in using their App URL (first 8 characters after `/restaurant/`). Have this ready before walking them through the reset.

---

## SECTION F: New Tablet Setup

**Source:** Dispatch Analyst Guide -- Initial Connection and Set-Up.

Most new tablet setup is handled by the Restaurant Growth Team, but support may assist if a new partner has trouble.

### For All Tablet Types

**Step 1: Connect to Wi-Fi**
- Navigate to home screen or pull down the control panel
- Locate the Settings icon or Wi-Fi shortcut
- Find the restaurant's Wi-Fi network and connect

**Step 2: Volume & Time Zone**
- Set volume to **maximum** (so order notifications are audible)
- Go to System -> Date & Time settings
- Enable **"Use network-provided time"**
- Verify the time zone matches the restaurant's local time zone
- Confirm the displayed time is correct

**Step 3: Open App and Enter Restaurant ID**
- Launch the **Valley Eats POS App** from the home screen
- Enter the provided Restaurant ID to log in
- The ID is the first **8 alphanumeric characters** after `/restaurant/` in the App URL (found on the restaurant's page in dispatch)

**Step 4: Test Order & Notifications**
Working with a Valley Eats team member:
1. Set the restaurant hours to **open**
2. Send a **test order**
3. Verify the order appears on screen with a **sound notification**
4. Have the restaurant **decline** the test order with reason: "test"
5. Set hours back to **closed** until the restaurant is ready to launch

---

## Offer Interim Solutions During Troubleshooting

While troubleshooting, if the tablet is not functional:
1. **Ask the restaurant:** "While we work on this, would you like us to halt your restaurant or would you prefer we call in any orders to you by phone?"
2. If they choose halt: follow `restaurant-halting.md`
3. If they choose call-in: note on the restaurant record that orders should be called in, and alert the market dispatcher

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `SendRestaurantMessage` | GREEN | Sending test messages to verify tablet connectivity |
| `UpdateRestaurant` (DeliveryAvailable) | YELLOW | Halting restaurant due to unresolvable tablet issue |
| `AddTicketNote` | GREEN | Documenting troubleshooting steps and outcomes |
| `CreateTicket` | GREEN | Requesting tablet replacement from Growth team |

## Escalation

Escalate to supervisor if:
- Tablet needs physical replacement (create ticket for Growth team)
- The restaurant has persistent tablet issues that recur frequently
- Multiple restaurants in the same area report connectivity issues simultaneously (possible ISP or infrastructure problem)
- The restaurant is frustrated and the troubleshooting is not resolving the issue -- supervisor may need to manage the relationship
- New tablet setup is failing despite following all steps

## Audit Requirements

Every troubleshooting session is logged with:
- `restaurantId` and `RestaurantName`
- Tablet model
- Steps attempted and outcomes
- Resolution or escalation path taken
- Whether the restaurant was halted or put on call-in during troubleshooting
- Timestamp and executing agent identity

These records are reviewable in the dispatch activity log and included in the shift summary.
