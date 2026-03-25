# 13 - Dispatch Data Filters: Exact Filtering Logic from dispatch.valleyeats.ca

> Research date: 2026-03-25
> Source files examined:
> - `/Volumes/Macxtra/ValleyEats/Dispatch/dispatch/index.php` (market loading, sidebar navigation)
> - `/Volumes/Macxtra/ValleyEats/Dispatch/dispatch/pages/dispatchpage.php` (main dispatch UI, JS order/driver rendering)
> - `/Volumes/Macxtra/ValleyEats/Dispatch/dispatch/post/getdispatchfile.php` (S3 data loader)
> - `/Volumes/Macxtra/ValleyEats/Dispatch/dispatch/post/getdispatchview.php` (side panel driver/order view)
> - `/Volumes/Macxtra/ValleyEats/Dispatch/dispatch/post/getalldrivers.php` (driver query by group)
> - `/Volumes/Macxtra/ValleyEats/Dispatch/dispatch/post/getdriverswithfilters.php` (advanced driver filtering)
> - `/Volumes/Macxtra/ValleyEats/Dispatch/dispatch/post/builddispatchcache.php` (search/lookup cache builder)
> - `/Volumes/Macxtra/ValleyEats/Dispatch/dispatch/post/savemarketstatus.php` (toggle market Active flag)
> - DynamoDB `ValleyEats-AppSettings` (Setting = "Delivery")
> - S3 `s3://valleyeats/dispatch.txt` (live dispatch snapshot)

---

## 1. MARKET FILTERS

### How Markets Are Defined

Markets (aka "DeliveryZones") are stored in a **single DynamoDB item**:

```
Table:  ValleyEats-AppSettings
Key:    Setting = "Delivery"
Field:  DeliveryZones (Map)
```

Each key in `DeliveryZones` is a zone name (e.g., "Pembroke", "Arnprior", "CarletonPlace"). Each zone is a Map containing its configuration.

### How the Dispatch Page Loads Markets

**index.php** (lines 206-310):
```php
$marketPromise = $dbclient->getItemAsync(array(
    'TableName' => 'ValleyEats-AppSettings',
    'Key' => array('Setting' => array('S' => 'Delivery'))
));
// ...later...
$result = $marketPromise->wait();
$markets = $result->get('Item');
```

The sidebar iterates **ALL keys** in `DeliveryZones.M` to build the navigation (lines 339-344):
```php
foreach($markets['DeliveryZones']['M'] as $key => $value) {
    array_push($singlePage['Markets'], $key);
}
$_SESSION['markets'] = $singlePage['Markets'];
```

**Key finding: The sidebar shows ALL zones from DeliveryZones, regardless of Active flag.**

### The Active Flag

Each zone has an `Active` (BOOL) flag. This controls:

1. **Whether the market is "live" for ordering** -- toggled via `savemarketstatus.php` which sets `DeliveryZones.{zone}.Active = true/false`
2. **Driver filtering in getalldrivers.php and getdriverswithfilters.php** -- these explicitly check `Active=true` before including a zone's drivers

**However, on the dispatch page itself (dispatchpage.php line 53), the Active check is COMMENTED OUT:**
```php
//if($setting['DeliveryZones']['M'][$market]['M']['Active']['BOOL']) {
```

This means the dispatch page renders tabs for ALL markets the user has selected, regardless of Active status. The Active flag is more of a "customer-facing" toggle (can customers place orders in this zone?) than a dispatch-page filter.

### Current State of All Markets (Live Data)

All 18 zones currently have `Active = true`:

| Zone | Active | DeliveryAvailable | AreaNames | DisplayString |
|------|--------|-------------------|-----------|---------------|
| Arnprior | true | true | Arnprior, Renfrew | Arnprior |
| Bancroft | true | true | -- | Picton |
| CarletonPlace | true | true | Almonte, CarletonPlace | Carleton Place/Almonte |
| Casselman | true | true | -- | Casselman |
| DeepRiver | true | true | -- | Deep River |
| Embrun | true | true | -- | Embrun/Russell |
| Gananoque | true | true | Gananoque | Gananoque |
| Goderich | true | true | Goderich | Goderich |
| Kemptville | true | true | -- | Kemptville |
| Pembroke | true | true | Pembroke, Petawawa | Pembroke/Petawawa |
| Perth | true | true | Perth, SmithsFalls | Perth |
| Picton | true | true | -- | Picton |
| PortElgin | true | true | -- | Port Elgin/Southampton |
| PortPerry | true | true | -- | Port Perry |
| Prescott | true | true | Prescott | Prescott |
| Renfrew | true | true | Arnprior, Renfrew | Renfrew |
| SmithsFalls | true | true | Perth, SmithsFalls | Smiths Falls |
| Stittsville | true | true | -- | Stittsville |

### The DeliveryAvailable Flag

Separate from `Active`. This is a real-time toggle (e.g., "shut off delivery during a storm"). On the dispatch page, if `DeliveryAvailable = false`, the tab gets a CSS class `takeoutOnly` (line 869):
```javascript
if(delivery && delivery.DeliveryAvailable) {
    $("#HoldTab"+zone).removeClass("takeoutOnly");
} else {
    $("#HoldTab"+zone).addClass("takeoutOnly");
}
```

### Zone Hierarchy: DispatchZone vs DeliveryArea

This is a critical distinction:

- **DispatchZone** (on the Driver record) -- The parent zone. Determines which market tab a driver belongs to. Matches the key in `DeliveryZones`. Examples: "Pembroke", "CarletonPlace", "Arnprior".
- **DeliveryArea** (on the Driver record) -- The sub-area within a DispatchZone. For zones with `AreaNames`, the DeliveryArea matches one of the area names. Example: A driver in DispatchZone="Pembroke" might have DeliveryArea="Pembroke" or DeliveryArea="Petawawa".
- **DeliveryZone** (on the Order record) -- Which market this order belongs to. Matches a key in `DeliveryZones`.
- **AreaNames** (on the zone config) -- Sub-areas within a DispatchZone. Pembroke zone has AreaNames=["Pembroke","Petawawa"]. CarletonPlace has AreaNames=["Almonte","CarletonPlace"].

### Market Selection Persistence

Users can add/remove market tabs and reorder them. The selection is stored in a cookie (`Markets`). The `addMarket()` JS function lets users pick from `AllMarkets` (which is the full list from the PHP `$Markets` array). The default zone if none specified is "Pembroke".

---

## 2. DRIVER FILTERS

### The dispatch.txt Data Source

The dispatch page does NOT query DynamoDB directly for drivers. It reads a pre-computed **S3 file**:

```
S3 Bucket: valleyeats
Key:       dispatch.txt
```

This file is a JSON snapshot generated by a **Lambda function** (not in the dispatch codebase -- it runs server-side). It contains one key per market zone, plus a `Timestamp`. Each zone contains `Drivers`, `Orders`, `Alerts`, `Delivery`, and `Meter`.

The dispatch page fetches this file via `getdispatchfile.php`, which simply downloads `dispatch.txt` from S3 and returns it.

### Which Drivers Appear in dispatch.txt

Based on live analysis of dispatch.txt, **only Active=true drivers appear**. Of 748 total drivers in DynamoDB:
- 453 have `Active = true`
- 63 have `Active = false`
- 232 have no `Active` attribute at all

The Lambda that generates dispatch.txt filters to only include drivers who are relevant to the current dispatch state. At the time of analysis:
- **57 drivers** were in dispatch.txt (out of 748 total)
- **All 57** had `Active = true`
- **56** had `OnShift = true`, **1** had `OnShift = false`
- All had `Paused = false` at the time

### Driver Fields in dispatch.txt

Each driver object includes:
- `DriverId`, `FullName`, `Monacher` -- identity
- `DispatchZone`, `DeliveryArea`, `DeliveryZone` -- zone assignment
- `Active` (bool) -- whether the driver account is enabled
- `Available` (bool) -- whether the driver has toggled "available" / on-call in the app
- `OnShift` (bool) -- whether the driver is currently within a scheduled shift
- `Paused` (bool) -- whether the dispatcher has paused this driver
- `NearEnd` (bool) -- whether the driver is near the end of their shift
- `OnMap` (bool) -- whether to show the driver on the map
- `DriverLocation` -- GPS coordinates
- `Alcohol` (bool) -- Smart Serve certified
- `TrainingOrders` (number) -- remaining training orders
- `ShiftStart` -- timestamp of shift start (only present when on shift)
- `ETA` -- unique ETA for this driver
- `geoData`, `json`, `Routed` -- route data for map display

### How the Dispatch Page Renders Drivers

**dispatchpage.php** processes the drivers array from dispatch.txt and assigns them visual states:

1. **Driver counting** (lines 952-957): A driver counts toward `driverCounter[zone]` (shown in the tab icon) only if:
   - They have a `ShiftStart` and are NOT paused, OR
   - They are `OnShift` and NOT paused

2. **Driver bar rendering** (lines 2288-2305): Visual states assigned based on:
   ```javascript
   if(drivers[driverIndex].Paused) {
       driverClass = " pausedDriver";          // gray
   } else if(breaktime) {
       driverClass = ' breakDriver';           // amber
   } else if(value.NearEnd) {
       driverClass = ' lazyDriver';            // near end of shift
   } else if(!value.OnShift) {
       driverClass = ' freeDriver';            // slate/gray - not on shift
   } else if(value.Late !== 0) {
       driverClass += ' lateDriver';           // red
   } else if(value.Conflict !== 0) {
       driverClass += ' conflictDriver';       // amber
   } else if(value.Orders.length === 0) {
       driverClass += ' emptyDriver';          // no orders
   } else {
       driverClass += ' idealDriver';          // normal/green
   }
   ```

3. **Inactive driver indicator** (lines 1635, 1839): When building the driver dropdown for order reassignment, inactive drivers get a lock icon:
   ```javascript
   if(drivers[i].Active === undefined || !drivers[i].Active) {
       attach += "🔒";   // lock icon = disabled driver
   }
   ```

### The Side-Panel Driver View (getdispatchview.php)

This older view queries DynamoDB directly (not dispatch.txt):

```php
$driverparams = [
    'TableName' => $ini_array['prefix']."Drivers",
    'FilterExpression' => "attribute_exists(DispatchZone) AND DispatchZone = :zone",
    'ExpressionAttributeValues' => [':zone' => ['S' => $zone]]
];
```

**Filter: `DispatchZone = selected zone`** (NO Active filter in the scan itself).

Then in PHP rendering (line 127):
```php
if(!isset($driver["Active"]) || (isset($driver["Active"]) && $driver["Active"]["BOOL"] === false)) {
    echo "🔒"; // lock icon for inactive
}
```

So inactive drivers are SHOWN but marked with a lock icon. They're not hidden.

For the "Scheduled" section, drivers are filtered to only those with a schedule entry for today.
For the "On Call" section, drivers are filtered by `Available = true`.

### Driver Fields on the DynamoDB Record

| Field | Type | Meaning |
|-------|------|---------|
| `Active` | BOOL | Account enabled. `false` or missing = disabled/inactive. 453 true, 63 false, 232 missing. |
| `Available` | BOOL | Driver toggled "available" in app (on-call mode). Currently 15 drivers. |
| `Paused` | BOOL | Dispatcher has paused this driver mid-shift. |
| `DispatchZone` | String | Parent market zone (e.g., "Pembroke", "CarletonPlace"). |
| `DeliveryArea` | String | Sub-area (e.g., "Pembroke", "Petawawa", "Almonte"). |
| `Monacher` | String | Short display name / codename (e.g., "MDN", "JEM"). |

---

## 3. ORDER FILTERS

### Which Orders Appear in dispatch.txt

The Lambda that generates dispatch.txt pre-filters orders. Based on live analysis:

**Order statuses found in dispatch.txt: `Placed`, `Confirmed`, `Ready`, `InTransit`**

**Order statuses NOT found: `InProgress`, `Delivered`, `Cancelled`**

This confirms the user's observation: **"In Progress" orders don't show because they haven't been placed/confirmed yet.** The order lifecycle is:

```
InProgress  -->  Placed  -->  Confirmed  -->  Ready  -->  InTransit  -->  Delivered
    |                                                                        |
    |                                                                        |
    v                                                                        v
(not in dispatch.txt)                                              (not in dispatch.txt)
```

The `InProgress` status means the order is still being built in the app (cart stage) or the payment hasn't been captured yet. The Stripe webhook (`charges_webhook.php`, line 89) transitions orders from `InProgress` to `Placed` when payment succeeds:
```php
':placed' => ['S' => "Placed"],
// ...
'UpdateExpression' => "SET OrderStatus = :placed, OrderPlacedTime = :placedtime, ChargeId = :chargeid"
```

### Client-Side Order Filtering (dispatchpage.php)

Even after receiving the orders from dispatch.txt, the dispatch page applies additional client-side filters:

#### Time Filter (default: 1 hour)
```javascript
var timeFilter = 3600; // seconds
```
Options: 0 minutes, 15 min, 30 min, 1 hour (default), 2 hours, Today (all).

Orders where `OrderReadyTime` is more than `timeFilter` seconds in the future are hidden.

#### Type Filter (default: ALL)
Options: `Placed`, `Unconfirmed`, `Problem`, `ALL` (default).

The `checkOrderFiltered()` function (line 2487) returns `true` to HIDE an order:

**For Delivery orders:**
```javascript
// Hide if ready time is beyond time filter window
if(filterTime + timeFilter < order.OrderReadyTime) return true;

// Type filter: Placed
if(typeFilter === "Placed" && order.OrderStatus !== "Placed") return true;

// Type filter: Unconfirmed
if(typeFilter === "Unconfirmed" && order.DeliveryConfirmed === true
   && order.OrderConfirmedNotifiedTime !== undefined) return true;

// Type filter: Problem -- shows orders that have issues:
//   - Unconfirmed and ready time is in 5 min or less
//   - Not picked up and 5+ min after ready time
//   - Not delivered and 10+ min past expected delivery
//   - Conflicting with driver's other orders
//   - Assigned driver not on shift or paused
```

**For Takeout orders:**
```javascript
if(filterTime + timeFilter < order.OrderReadyTime) return true;
if(typeFilter === "Placed" && order.OrderStatus !== "Placed") return true;
if(typeFilter === "Unconfirmed" && order.OrderConfirmedNotifiedTime !== undefined) return true;
// Problem filter: unconfirmed with ready time in 5 min or less,
//                 OR 5+ min past ready time (not picked up)
```

#### Restaurant Exclusion (hardcoded)
Two specific restaurants are always excluded from the dispatch table (line 1002):
```javascript
if(orders[orderIndex].RestaurantId === "ab8a647e-4c41-4afb-9a93-9da5fdffe93d" ||
   orders[orderIndex].RestaurantId === "70b13a1d-24b1-4114-8662-6854bfa38591") {
    continue;
}
```

#### Order Count Logic
Orders increment `orderCounter[zone]` only when the ready time is within the ETA window (line 1068-1069):
```javascript
if(timestamp + eta >= pickup) {
    orderCounter[zone]++;
}
```

---

## 4. THE DISPATCH DATA PIPELINE (dispatch.txt)

### Architecture

```
Lambda (server-side, every ~20 seconds)
    |
    | Queries DynamoDB: Drivers, Orders, AppSettings
    | Filters & aggregates by market zone
    | Computes Meter scores, Alerts, route data
    |
    v
S3: valleyeats/dispatch.txt  (single JSON file)
    |
    v
getdispatchfile.php (PHP proxy)
    |
    v
dispatchpage.php JS: buildMarkets()
    |
    | Parses JSON, applies client-side filters
    | Renders driver bar, order table, map markers
    v
Browser UI
```

### dispatch.txt Structure

```json
{
  "Timestamp": 1774477790,
  "Pembroke": {
    "Drivers": [...],       // Pre-filtered driver list for this zone
    "Orders": [...],        // Active orders (Placed/Confirmed/Ready/InTransit)
    "Alerts": [...],        // ETA alerts, delay notices
    "Delivery": {...},      // Full zone config from AppSettings.DeliveryZones.Pembroke
    "Meter": {              // Busyness gauge data
      "ts": 1774477790,
      "Market": "Pembroke",
      "Score": 16,          // Busyness percentage
      "idealDrivers": 15,
      "drivers": 17
    }
  },
  "Arnprior": {...},
  // ... one key per market zone
}
```

### Historical Replay

dispatch.txt snapshots are archived to S3 under `DispatchImages/{date}/{timestamp}.txt`. The dispatch page can replay historical data by passing a `Timestamp` parameter.

---

## 5. SEARCH/LOOKUP CACHE (builddispatchcache.php)

This is a separate system from the dispatch data. It builds a searchable cache of ALL users, drivers, and restaurants for the omni-search bar. Key points:

- **No filtering at all**: Scans the ENTIRE Drivers, Users, and Restaurants tables
- Builds lookup arrays for name, email, phone, address
- Drivers sorted by Monacher (codename), users by name, restaurants by name
- Includes DriverBans data (restaurant/customer bans per driver)
- Cached to a daily JSON file at `logs/cache/{date}.json`
- Used for the autocomplete search and modal popups, NOT for the dispatch table

---

## 6. SUMMARY: EXACT FILTERS FOR SISYPHUS TO REPLICATE

### Markets
1. Query `ValleyEats-AppSettings` where `Setting = "Delivery"`
2. Read `DeliveryZones` map -- each key is a market zone
3. All zones in `DeliveryZones` are available for dispatch viewing (Active flag is NOT used to filter dispatch tabs)
4. `Active` flag controls customer-facing availability and some driver queries
5. `DeliveryAvailable` flag controls real-time delivery availability (visual indicator)
6. Some zones have `AreaNames` for sub-areas (Pembroke has Pembroke/Petawawa, CarletonPlace has Almonte/CarletonPlace)

### Drivers
1. Primary data source: **dispatch.txt from S3** (pre-filtered by Lambda)
2. The Lambda includes drivers who are **Active=true AND currently relevant** (on shift, available, or recently active)
3. Drivers are grouped by `DispatchZone` into their market tab
4. Driver states visible on the dispatch bar:
   - **On shift, working** (green) - `OnShift=true`, has orders
   - **On shift, empty** (green outline) - `OnShift=true`, no orders
   - **Paused** (gray) - `Paused=true`
   - **On break** (amber) - within break time window
   - **Near end of shift** (lazy) - `NearEnd=true`
   - **Free/off-shift** (slate) - `OnShift=false`
   - **Late** (red) - has orders past ready time
   - **Conflict** (amber) - has conflicting orders
5. Inactive drivers (`Active=false` or missing) shown with lock icon in driver dropdowns
6. Driver count = drivers with `ShiftStart` or `OnShift=true`, AND `Paused=false`

### Orders
1. Primary data source: **dispatch.txt from S3** (pre-filtered by Lambda)
2. **Only orders with status `Placed`, `Confirmed`, `Ready`, or `InTransit`** appear
3. `InProgress` orders are excluded (payment not yet captured)
4. `Delivered` and `Cancelled` orders are excluded
5. Client-side time filter: default 1 hour window from current time based on `OrderReadyTime`
6. Client-side type filter: ALL (default), Placed only, Unconfirmed, Problems
7. Two hardcoded restaurant IDs are always excluded
8. Orders are only counted in the tab badge when `OrderReadyTime` is within the ETA window
