---
agent: driver-comms
trigger: driver_app_issues
priority: normal
version: "1.0"
---

# Process: Driver App Issues and Troubleshooting

## Trigger

When a courier reports problems with their driver app, including the app crashing, freezing, not displaying orders, GPS/navigation issues, or connectivity problems.

Common triggers:
- Courier messages: "The app keeps crashing," "I can't see the order details," "My app is frozen," "Map isn't loading," "Orders aren't showing," "GPS is wrong"
- Courier reports blank screen or app not loading
- Courier cannot see assigned orders
- Courier reports GPS taking them to the wrong location
- Orders are not appearing on the courier's device

## Prerequisites

Before troubleshooting, gather context:
- [ ] `query_drivers({ driverId })` -- check `AppVersion`, `phoneModel`, `ConnectionId`, `Available`, `Paused`, `DispatchZone`
- [ ] `query_orders({ driverId, status: ["Confirmed", "Ready", "EnRoute", "InTransit"] })` -- active orders for this courier
- [ ] `get_entity_timeline("driver", driverId, hours=2)` -- recent interactions

**Key driver fields:**
- `AppVersion` -- the driver app version; outdated versions cause many issues
- `phoneModel` -- the device model; some devices have known problems
- `ConnectionId` -- WebSocket connection; null means the driver is offline and may not receive messages
- `Available` -- whether the driver is accepting orders
- `Paused` -- whether the driver is temporarily paused

## Issue Type 1: Orders Not Displaying

When a courier reports they cannot see their assigned orders in the app.

### Step 1: Verify Orders Are Assigned

Check the dispatch system to confirm the courier actually has orders assigned to them.
- `query_orders({ driverId, status: ["Confirmed", "Ready", "EnRoute"] })`
- If no orders are assigned, let the courier know:
  > "Hi {firstName}, I'm not seeing any orders assigned to you right now. You should see one when it comes in."

### Step 2: Check Data Connection and Wi-Fi

**This is the most common cause of orders not displaying.**

Some restaurants (like McDonald's) offer free Wi-Fi that requires a login. When a courier's phone auto-connects to these networks, it blocks the data connection and the app goes blank.

Ask the courier:
> "Hi {firstName}, can you check if your Wi-Fi is turned off? Sometimes restaurant Wi-Fi networks interfere with the app. Please turn off Wi-Fi and make sure you're on your mobile data connection."

### Step 3: Restart the App

If the data connection is confirmed working:
> "Please shut down the app completely and reopen it."

After the courier restarts the app, send them a **test message** to verify the connection is working:
> "Test message -- can you see this? Let me know."

If the courier receives the test message, the app is functioning. If orders still do not appear, escalate.

### Step 4: If Issue Persists

If orders are still not displaying after verifying data connection and restarting:
- Check `ConnectionId` -- if null, the courier is disconnected from the server
- Check `AppVersion` -- if outdated, the courier needs to update
- As a last resort, have the courier restart their phone entirely
- If the issue persists after all steps, escalate as a system issue

## Issue Type 2: App Crashing or Freezing

When the courier's app repeatedly crashes, freezes, or becomes unresponsive.

### Step 1: Check App Version

Check the `AppVersion` field. If the courier is on an older version:
> "Hi {firstName}, it looks like you're on version {AppVersion}. We recommend updating to the latest version -- that should fix the issue. Let me know if it persists after updating."

### Step 2: Basic Troubleshooting

If the app version is current:
> "Hi {firstName}, sorry about the app trouble. Try closing the app completely and reopening it. If that doesn't work, try restarting your phone. Let me know if the issue continues."

Steps for the courier:
1. Close the app completely (not just minimize -- force close)
2. Reopen the app
3. If still crashing, restart the phone
4. Close all other applications to free up memory
5. Check for app updates in the app store

### Step 3: Check Device Compatibility

Check the `phoneModel` field for known problematic devices. Some older or low-memory devices may not run the app reliably.

### Step 4: Check Connection Status

If `ConnectionId` is null, the driver is offline and may not receive messages:
- Log the issue and wait for them to reconnect
- **If the courier has an active order**, flag to supervisor for potential reassignment -- the order cannot wait for the courier to resolve their app issue

## Issue Type 3: GPS and Navigation Issues

When the courier reports the GPS is sending them to the wrong place, the address does not exist, or they cannot find the restaurant or customer.

### Step 1: Verify the Address

Get the relevant order details:
- `DeliveryStreet`, `DeliveryCity`, `DeliveryProvince` for customer delivery
- `OrderLocation` (latitude, longitude) for the restaurant
- `CustomerLocation` (latitude, longitude) for the delivery

**Restaurant navigation issue:**
> "Hi {firstName}, the restaurant ({RestaurantName}) should be at {restaurant address}. If you're having trouble, here are the coordinates: {latitude}, {longitude}. Call the restaurant at {Restaurant.Phone} if needed."

**Customer delivery navigation issue:**
> "Hi {firstName}, the delivery address is {DeliveryStreet}, {DeliveryCity}. Delivery instructions: {DeliveryInstructions or 'none provided'}. If you still can't find it, try calling the customer."

### Step 2: Use HERE Maps for Verification

Valley Eats uses HERE location services (wego.here.com) for mapping. Use this to verify whether the address is valid and where the pin lands:
- Input the address into wego.here.com
- Confirm the pin is at the correct location
- If the pin is incorrect, use the order modal to input addresses until the pin appears at the correct location

### Step 3: Address Is Genuinely Invalid

If the address cannot be found or is unreachable:
- Escalate to supervisor, who may contact the customer for a corrected address
- If the customer provides a new address, update it in the order:
  1. Click "Modify Order" in the order
  2. Input the new address
  3. Click "Geolocate" and "Calculate" buttons
  4. Write a reason in "Modify Notes"
  5. Confirm the new pin is in the correct location on the map
  6. Notify the courier of the updated address

### Step 4: GPS Issues on the Device

If the issue is with the courier's phone GPS rather than our address data:
> "Hi {firstName}, try turning your phone's location/GPS off and back on. Also make sure you have a clear view of the sky -- GPS can be less accurate indoors or in parking garages."

## Issue Type 4: General App Malfunction

For any other app issue (buttons not working, screens not loading, display errors):

### Troubleshooting Steps (In Order)

1. **Close and reopen the app**
2. **Turn Wi-Fi off, ensure mobile data is on**
3. **Update the app** to the latest version
4. **Restart the phone**
5. **Close all other applications**

After each step, send a test message to verify the app is working.

### When to Escalate

- Courier has an active order and cannot see it due to app issues -- **escalate to supervisor for potential reassignment immediately**
- App issue persists after all troubleshooting steps -- escalate as a system issue with a ticket including `AppVersion`, `phoneModel`, and steps tried
- Multiple couriers reporting the same app issue simultaneously -- **escalate as a system anomaly** (this suggests a server-side problem, not a device issue)

## Response Templates

**Outdated app version:**
> "Hi {firstName}, it looks like you're on version {AppVersion}. We recommend updating to the latest version -- that should fix the issue. Let me know if it persists after updating."

**General app trouble:**
> "Hi {firstName}, sorry about the app trouble. Try closing the app completely and reopening it. If that doesn't work, try restarting your phone. Let me know if the issue continues."

**Wi-Fi interference:**
> "Hi {firstName}, can you check if your Wi-Fi is turned off? Sometimes restaurant Wi-Fi networks interfere with the app. Please turn off Wi-Fi and make sure you're on your mobile data connection."

**Test message after restart:**
> "Test message -- can you see this? Let me know."

**Driver offline (ConnectionId null):**
> Driver is offline and may not receive messages. Log the issue and wait for reconnection. If they have an active order, flag to supervisor for potential reassignment.

**Restaurant navigation help:**
> "Hi {firstName}, the restaurant ({RestaurantName}) should be at {address}. Here are the coordinates: {latitude}, {longitude}. Call the restaurant at {phone} if needed."

**Customer delivery navigation help:**
> "Hi {firstName}, the delivery address is {DeliveryStreet}, {DeliveryCity}. Delivery instructions: {instructions}. If you still can't find it, try calling the customer."

## Available Actions

| Ontology Action | Tier | When to Use |
|----------------|------|-------------|
| `SendDriverMessage` | YELLOW | Troubleshooting instructions and test messages |
| `AddTicketNote` | GREEN | Documenting the app issue and troubleshooting steps taken |
| `ReassignOrder` | YELLOW | Reassigning active orders when courier's app is non-functional |
| `EscalateTicket` | GREEN | Persistent app issues, system anomalies, active orders at risk |
| `request_clarification` | -- | Escalating to supervisor for reassignment or system-wide issues |

## Cooldown Rules

| Action | Minimum Wait | Max Attempts |
|--------|-------------|--------------|
| Troubleshooting message | 0 (immediate) | -- |
| Test message after restart | After courier confirms restart | 1 |
| Follow-up if no response | 5 minutes | 3 |
| Escalation for active order | 0 (immediate if courier cannot function) | 1 |

## Escalation

Escalate to supervisor if:
- Courier has active order(s) and cannot operate due to app failure
- App issue persists after full troubleshooting sequence
- Multiple couriers report the same issue (system anomaly)
- GPS/address issue is genuinely invalid -- supervisor may need to contact the customer
- Courier is offline (`ConnectionId` null) with active orders and not reconnecting
