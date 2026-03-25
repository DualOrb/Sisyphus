# Sisyphus: Ontology ↔ Data Mapping

**Date:** 2026-03-25
**Status:** Planning
**Source:** `10-data-model-discovery.md` (live DynamoDB exploration) + DynaClone MySQL research

---

## 1. Purpose

This document maps our ontology object types (from `09-ontology-layer-design.md`) to the actual DynamoDB tables and fields discovered in production. Every Zod schema we write should be grounded in this mapping.

---

## 2. Data Access Strategy

### Read Path
| Source | When to Use | Latency |
|--------|------------|---------|
| **Dispatch REST API** | Primary path — use the 38 existing Lambda endpoints | ~100-300ms |
| **DynamoDB Direct** | When dispatch API doesn't expose needed data | ~10-50ms |
| **DynaClone (MySQL)** | Complex aggregations, joins, time-range driver shift queries | ~50-200ms |
| **S3 Dispatch Snapshots** | Real-time market state (already exists, updated every ~30s) | ~100ms |
| **Redis Cache** | Hot ontology objects, cooldowns, locks | ~1ms |

### Write Path
| Target | When to Use |
|--------|------------|
| **Browser Executor** | Visible actions (assignments, messages, status changes) |
| **Dispatch REST API** | Background writes (notes, internal flags) |
| **DynamoDB Direct** | Sisyphus-specific tables (audit log, shift summaries) |
| **Never write to DynaClone** | It's a read-only replica that syncs from DynamoDB automatically |

---

## 3. Object Type Mappings

### 3.1 Order

**DynamoDB Table:** `ValleyEats-Orders`

| Ontology Property | DynamoDB Field | Type | Notes |
|-------------------|---------------|------|-------|
| `orderId` | `OrderId` | string (UUID) | PK |
| `orderIdKey` | `OrderIdKey` | string | First 8 chars, human-friendly |
| `status` | `OrderStatus` | enum | "Completed", "Cancelled", "Pending", etc. |
| `orderType` | `OrderType` | enum | "Delivery", "Takeout" |
| `customerId` | `UserId` | string (email) | FK to Users |
| `driverId` | `DriverId` | string (email) \| null | FK to Drivers |
| `restaurantId` | `RestaurantId` | string (UUID) | FK to Restaurants |
| `restaurantName` | `RestaurantName` | string | Denormalized |
| `deliveryZone` | `DeliveryZone` | string | Market name (e.g., "Perth") |
| `deliveryAddress` | `DeliveryStreet` + `DeliveryCity` + `DeliveryProvince` | composite | |
| `deliveryType` | `DeliveryType` | enum | "Leave at door", "Hand delivered" |
| `deliveryInstructions` | `DeliveryInstructions` | string \| null | |
| `customerLocation` | `CustomerLocation` | `{latitude, longitude}` | |
| `orderLocation` | `OrderLocation` | `{latitude, longitude}` | Restaurant location |
| `subtotal` | `OrderSubtotal` | number | **CENTS** (integer) |
| `tax` | `Tax` | number | **CENTS** |
| `deliveryFee` | `DeliveryFee` | number | **CENTS** |
| `tip` | `Tip` | number | **CENTS** |
| `total` | `OrderTotal` | number | **CENTS** |
| `hasAlcohol` | `Alcohol` | boolean | |
| `isAsap` | `ASAP` | boolean | |
| `items` | `OrderItems` | embedded array | See OrderItem sub-schema |
| **Lifecycle timestamps (all Unix epoch seconds):** | | | |
| `createdAt` | `OrderCreatedTime` | number | |
| `placedAt` | `OrderPlacedTime` | number | |
| `confirmedAt` | `DeliveryConfirmedTime` | number \| null | Restaurant confirmed |
| `driverAssignedAt` | `DriverAssignedTime` | number \| null | |
| `readyAt` | `OrderReadyTime` | number \| null | Food ready |
| `inBagAt` | `OrderInBagTime` | number \| null | |
| `enrouteAt` | `EnrouteTime` | number \| null | Driver heading to restaurant |
| `inTransitAt` | `OrderInTransitTime` | number \| null | On way to customer |
| `atCustomerAt` | `AtCustomerTime` | number \| null | Arrived at customer |
| `deliveredAt` | `OrderDeliveredTime` | number \| null | |
| **Computed (ontology-side):** | | | |
| `isLate` | — | boolean | Computed from ETA vs actual |
| `waitTimeMinutes` | — | number | `now - placedAt` |
| `timeSinceReady` | — | number \| null | `now - readyAt` |

**Key GSIs for queries:**
- Active orders by zone: `DeliveryZone-OrderReadyTime-index`
- Orders by driver: `DriverId-OrderReadyTime-index`
- Orders by status: `OrderStatus-DriverId-index`
- Orders by customer: `UserId-index`

---

### 3.2 Driver

**DynamoDB Table:** `ValleyEats-Drivers`

| Ontology Property | DynamoDB Field | Type | Notes |
|-------------------|---------------|------|-------|
| `driverId` | `DriverId` | string (email) | PK — **email address, not UUID** |
| `name` | `FullName` | string | |
| `phone` | `Phone` | string | |
| `agentId` | `AgentId` | string (UUID) | Internal reference ID |
| `dispatchZone` | `DispatchZone` | string | Current dispatch zone |
| `deliveryArea` | `DeliveryArea` | string | Assigned delivery area |
| `isAvailable` | `Available` | boolean | Currently accepting orders |
| `isPaused` | `Paused` | boolean | Temporarily paused |
| `isActive` | `Active` | boolean | Employment status |
| `ignoreArea` | `ignoreArea` | boolean | Can deliver outside zone |
| `connectionId` | `ConnectionId` | string \| null | WebSocket connection |
| `appVersion` | `AppVersion` | string | |
| `phoneModel` | `phoneModel` | string | |
| `driverArn` | `DriverArn` | string | Push notification endpoint |
| `trainingOrders` | `TrainingOrders` | number | |
| **Computed (ontology-side):** | | | |
| `isOnline` | — | boolean | `isAvailable && !isPaused && connectionId != null` |
| `activeOrdersCount` | — | number | Count from Orders table query |
| `currentShift` | — | Shift \| null | From DriverShifts table |

**Related tables:**
- `ValleyEats-DriverShifts` — scheduled shifts (DriverId + shiftstart)
- `ValleyEats-DriverAvailability` — self-declared availability
- `ValleyEats-DriverMessages` — chat messages (DriverId + ts)
- `ValleyEats-DriverLatestMessage` — latest message cache
- `ValleyEats-DriverPoints` — performance points (DriverId + Interval)
- `ValleyEats-DriverBans` — banned customer pairings
- `ValleyEats-DriverLocationHistory` — GPS tracking per order

---

### 3.3 Restaurant

**DynamoDB Table:** `ValleyEats-Restaurants`

| Ontology Property | DynamoDB Field | Type | Notes |
|-------------------|---------------|------|-------|
| `restaurantId` | `RestaurantId` | string (UUID) | PK |
| `restaurantIdKey` | `RestaurantIdKey` | string | Short ID (8 chars) |
| `name` | `RestaurantName` | string | |
| `phone` | `Phone` | string | |
| `email` | `Email` | string | |
| `city` | `City` | string | |
| `province` | `Province` | string | |
| `deliveryZone` | `DeliveryZone` | string | Market zone |
| `cuisine` | `PrimaryCuisine` | string | |
| `priceLevel` | `Price` | number | 1-3 |
| `isActive` | `Restaurant` | boolean | Active flag |
| `deliveryAvailable` | `DeliveryAvailable` | boolean | |
| `commission` | `Commission` | number | Decimal (0.87 = 87%) |
| `posEta` | `POSETA` | number | Prep time estimate (minutes) |
| `kitchenHours` | `KitchenHours` | object | **Minutes from midnight** per day |
| `defaultHours` | `DefaultHours` | object | Customer-facing hours |
| `lastHeartbeat` | `LastHeartbeat` | number | Unix timestamp — tablet online check |
| `menuSections` | `MenuSections` | string[] | Ordered section names |
| **Computed (ontology-side):** | | | |
| `isOpen` | — | boolean | Computed from kitchenHours + current time |
| `isTabletOnline` | — | boolean | `now - lastHeartbeat < 5min` |
| `healthScore` | — | number | From `RestaurantHealthCache` table |
| `currentLoad` | — | number | Active orders count |

**Related tables:**
- `ValleyEats-MenuItems` — menu items (RestaurantId + ItemId)
- `ValleyEats-RestaurantHealthCache` — pre-computed health metrics
- `ValleyEats-RestaurantIntelligenceReports` — AI-generated reports

---

### 3.4 Customer

**DynamoDB Table:** `ValleyEats-Users`

| Ontology Property | DynamoDB Field | Type | Notes |
|-------------------|---------------|------|-------|
| `email` | `Email` | string (email) | PK — **email as primary key** |
| `name` | `FullName` | string | |
| `phone` | `Phone` | string | |
| `stripeCustomerId` | `CustomerId` | string | Stripe customer ID |
| `deliveryAddresses` | `DeliveryAddresses` | array | With lat/lng per address |
| `perksPoints` | `PerksPoints` | number | Loyalty points |
| `messages` | `Messages` | embedded array | In-app messages from support |
| `appVersion` | `AppVersion` | string | |
| `userArn` | `UserArn` | string | Push notification endpoint |
| **Computed (ontology-side):** | | | |
| `totalOrders` | — | number | Count from Orders table |
| `recentOrders` | — | Order[] | Last N orders |

---

### 3.5 Ticket (Issue)

**DynamoDB Table:** `ValleyEats-IssueTracker`

| Ontology Property | DynamoDB Field | Type | Notes |
|-------------------|---------------|------|-------|
| `issueId` | `IssueId` | string | PK — 8-char hash |
| `category` | `Category` | enum | "Order Issue", "Driver Issue" |
| `issueType` | `IssueType` | string | "Other", "Cancel Order", "Stale Driver Location", etc. |
| `status` | `IssueStatus` | enum | "New", "Pending", "Resolved", "Closed" |
| `createdAt` | `Created` | number | Unix timestamp |
| `orderId` | `OrderId` | string \| null | Linked order UUID |
| `orderIdKey` | `OrderIdKey` | string \| null | Short order ID |
| `restaurantId` | `RestaurantId` | string \| null | |
| `restaurantName` | `RestaurantName` | string \| null | Denormalized |
| `driverId` | `DriverId` | string \| null | |
| `market` | `Market` | string | |
| `originator` | `Originator` | string | Email or "Supervisor" (system) |
| `owner` | `Owner` | string | Assigned agent email or "Unassigned" |
| `description` | `Description` | string | |
| `resolution` | `Resolution` | string \| null | |
| `actions` | `Actions` | embedded array | Status change history |
| `messages` | `Messages` | embedded array | Customer ↔ support chat |
| `notes` | `Notes` | embedded array | Internal notes |

**Note:** Disputes table (`ValleyEats-Disputes`) is newer and more structured but has only ~3 records. For now, IssueTracker is the primary ticket system.

---

### 3.6 DeliveryZone (Market)

**DynamoDB Table:** `ValleyEats-MarketMeters` (primary) + `ValleyEats-Alerts` + `ValleyEats-DemandPredictions`

| Ontology Property | DynamoDB Source | Type | Notes |
|-------------------|----------------|------|-------|
| `market` | `MarketMeters.Market` | string | PK — market name |
| `score` | `MarketMeters.Score` | number | 0-100 (100 = critical need) |
| `idealDrivers` | `MarketMeters.idealDrivers` | number | How many drivers needed |
| `availableDrivers` | `MarketMeters.drivers` | number | How many are available |
| `lastUpdated` | `MarketMeters.ts` | number | Unix timestamp |
| `eta` | `Alerts.Eta` | string → number | Current ETA in minutes |
| `demandPredictions` | `DemandPredictions.Predictions` | array | ML forecasts with confidence |
| **Computed (ontology-side):** | | | |
| `driverGap` | — | number | `idealDrivers - availableDrivers` |
| `demandLevel` | — | enum | Derived from score thresholds |
| `activeOrders` | — | number | Count from Orders by zone |
| `driverToOrderRatio` | — | number | `availableDrivers / activeOrders` |

---

### 3.7 Conversation & Message

**DynamoDB Tables:** `ValleyEats-DriverMessages` + `ValleyEats-DriverLatestMessage`

| Ontology Property | DynamoDB Source | Type | Notes |
|-------------------|----------------|------|-------|
| **Conversation:** | | | |
| `driverId` | `DriverLatestMessage.DriverId` | string (email) | PK |
| `lastMessageAt` | `DriverLatestMessage.ts` | number | Unix timestamp |
| `lastMessagePreview` | `DriverLatestMessage.Message` | string | |
| `lastAuthor` | `DriverLatestMessage.Author` | string | Human-readable name |
| `lastOpenedAt` | `DriverLatestMessage.Opened` | number \| null | |
| **Message:** | | | |
| `driverId` | `DriverMessages.DriverId` | string (email) | PK |
| `timestamp` | `DriverMessages.ts` | number | SK — Unix timestamp |
| `content` | `DriverMessages.Message` | string | |
| `author` | `DriverMessages.Author` | string | Human-readable name |
| `colour` | `DriverMessages.Colour` | string | Author's chat color |
| `isDriver` | — | boolean | Computed: `Colour === "Undefined"` means driver sent it |

**Note:** When `Colour` is `"Undefined"`, the message was sent BY the driver (not to them). This is how the dispatch frontend distinguishes direction.

---

## 4. Existing AI System (Predecessor)

Sisyphus has a predecessor. Key tables to understand:

| Table | What It Contains | Sisyphus Relevance |
|-------|-----------------|-------------------|
| `AIDecisions-production` | 699K dispatch snapshot analyses with per-market metrics | **Replace with Sisyphus decisions** |
| `AIMetrics-production` | 3.2M shadow action records | **Seed action vocabulary** (operations_call_couriers, reassign_if_available) |
| `DispatchAiToolFeedback` | 6.7K human ratings on AI message enhancement | **Training data** for message quality |
| `AIWebSocketConnection-production` | WebSocket connections (currently empty) | Sisyphus uses DispatchConnections instead |

### Existing Action Vocabulary (from AIMetrics)

These are actions the predecessor AI system already tracks:

| Action | Issue Type | Severity | Description |
|--------|-----------|----------|-------------|
| `operations_call_couriers` | `courier_not_accepting` | critical | Escalate to ops team to phone drivers |
| `reassign_if_available` | `pickup_delay` | high | Reassign order to different driver |

Sisyphus should **extend** this vocabulary, not replace it.

---

## 5. DynaClone Access (MySQL)

### When Sisyphus Should Use DynaClone

DynaClone is valuable for queries that DynamoDB handles poorly:

| Query | Why DynaClone | SQL Pattern |
|-------|--------------|-------------|
| "Drivers on shift right now in market X" | Time-range + market filter + join | `SELECT FROM DriverShifts JOIN Drivers WHERE shiftstart < NOW() AND shiftend > NOW() AND area = ?` |
| "Available on-call drivers in market X" | Multi-condition filter | `SELECT FROM Drivers WHERE Available=1 AND DeliveryArea=? AND Paused!=1` |
| "Predicted drivers for 6 PM tonight" | Future time-range | `SELECT FROM DriverShifts WHERE shiftstart <= ? AND shiftend >= ? AND area = ?` |
| "Order subtotal for quick lookup" | Single field, high frequency | `SELECT OrderSubtotal FROM Orders WHERE OrderId = ?` |

### Connection Details

- **Host:** `iris.valleyeats.ca` (or `dynaclone.valleyeats.ca`)
- **Database:** `admin_dynaclone`
- **Credentials:** AWS Secrets Manager (`vendorportal/credentials`)
- **Client:** Use `mysql2` npm package (Node.js)
- **Table names:** Backtick-quoted DynamoDB names (`` `ValleyEats-Orders` ``)
- **IMPORTANT:** Read-only. All writes go to DynamoDB. DynaClone syncs automatically.

### Data Quirks in DynaClone

1. **Arrays stored as JSON objects:** DynamoDB lists become `{"0": {...}, "1": {...}}` in MySQL. Need `fixDynacloneArrays()` conversion.
2. **Type coercion:** All MySQL fields are strings. Need to parse numbers/booleans.
3. **Sync lag:** Small delay between DynamoDB write and DynaClone availability (~1-5 seconds).

---

## 6. Data Conventions Sisyphus Must Respect

| Convention | Rule | Examples |
|-----------|------|---------|
| **Monetary values** | Orders/Transactions in **cents** (integers) | `OrderTotal: 6695` = $66.95 |
| **Monetary values** | Disputes in **dollars** (decimals) | `Amount: 28.75` = $28.75 |
| **Timestamps** | Unix epoch **seconds** (not milliseconds) | `1717797194` |
| **Hours of day** | **Minutes from midnight** | `660` = 11:00 AM, `1320` = 10:00 PM |
| **Durations** | **Seconds** | `TravelTime: 477` = ~8 minutes |
| **Driver/User IDs** | **Email addresses** (not UUIDs) | `driver@example.com` |
| **Restaurant IDs** | **UUIDs** | `a166e272-c622-4879-...` |
| **Order IDs** | **UUIDs** (with 8-char short key) | `5727b0c4-...` / `5727b0c4` |
| **Issue IDs** | **8-char hash** | `b04b887b` |
| **Market names** | **PascalCase strings** | `PortElgin`, `Petawawa`, `Pembroke` |
| **Boolean flags** | DynamoDB `BOOL` type | `true` / `false` |
| **Driver message direction** | `Colour: "Undefined"` = from driver | All others = to driver |

---

## 7. Tables Sisyphus Needs to Create

Sisyphus needs its own tables (don't modify existing ones):

| Table | Purpose | Key Schema |
|-------|---------|-----------|
| `ValleyEats-SisyphusAuditLog` | Ontology action audit trail | PK: `Date`, SK: `LogId` (same pattern as DispatchActivityLogs) |
| `ValleyEats-SisyphusShiftSummary` | End-of-shift reports | PK: `ShiftDate`, SK: `ShiftId` |
| `ValleyEats-SisyphusEntityInteractions` | Cross-shift entity memory | PK: `EntityType#EntityId`, SK: `Timestamp` |

**Or:** Use PostgreSQL for Sisyphus-specific tables (as planned in `05-infrastructure.md`). The DynamoDB tables above follow the existing naming convention if we want to stay in DynamoDB.

**Recommendation:** Use PostgreSQL. Sisyphus's audit/memory patterns (time-range queries, aggregations, complex joins) are exactly what DynaClone exists to solve. PostgreSQL handles these natively without needing a separate sync layer.

---

## 8. Impact on Ontology Design (09)

The `09-ontology-layer-design.md` object types need these adjustments:

| Original Assumption | Reality | Change Needed |
|--------------------|---------| ------------- |
| `driverId` is a UUID | It's an email address | Update Zod schema type |
| `customerId` is a UUID | It's an email address (PK: `Email`) | Update Zod schema type |
| `status` values were guessed | Real values: "Completed", "Cancelled", "Pending", etc. | Update enum |
| `Ticket` was generic | Real structure has embedded `Actions`, `Messages`, `Notes` arrays | Add sub-schemas |
| Currency was abstract | All in **cents** (integers) for Orders | Document, add helpers |
| Hours were abstract | **Minutes from midnight** (e.g., 660 = 11 AM) | Document, add helpers |
| `DeliveryZone` was theoretical | It's just a string market name ("Perth", "Pembroke") | Simplify |
| Messages had `isDriver` field | Direction determined by `Colour === "Undefined"` | Add computed property |
| Conversation had `unreadCount` | Use `DriverLatestMessage.Opened` vs `DriverMessages` latest ts | Compute from two tables |
