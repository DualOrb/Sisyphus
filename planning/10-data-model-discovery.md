# ValleyEats DynamoDB Data Model Discovery

> Generated 2026-03-25 by exploring live AWS DynamoDB tables.
> This document serves as the canonical reference for designing the Sisyphus AI dispatcher ontology layer.

---

## Table of Contents

1. [Overview & Statistics](#overview--statistics)
2. [Core Entity Tables](#core-entity-tables)
   - [Orders](#1-valleyeats-orders)
   - [Drivers](#2-valleyeats-drivers)
   - [Restaurants](#3-valleyeats-restaurants)
   - [Users (Customers)](#4-valleyeats-users)
   - [Employees](#5-valleyeats-employees)
3. [Driver Operations Tables](#driver-operations-tables)
   - [DriverShifts](#6-valleyeats-drivershifts)
   - [DriverAvailability](#7-valleyeats-driveravailability)
   - [DriverMessages](#8-valleyeats-drivermessages)
   - [DriverLatestMessage](#9-valleyeats-driverlatestmessage)
   - [DriverPoints](#10-valleyeats-driverpoints)
   - [DriverBans](#11-valleyeats-driverbans)
   - [DriverLocationHistory](#12-valleyeats-driverlocationhistory)
   - [OpenShifts](#13-valleyeats-openshifts)
4. [Support & Issues Tables](#support--issues-tables)
   - [IssueTracker](#14-valleyeats-issuetracker)
   - [Disputes](#15-valleyeats-disputes)
   - [OrderErrors](#16-valleyeats-ordererrors)
5. [AI & Dispatch Tables](#ai--dispatch-tables)
   - [AIDecisions](#17-valleyeats-aidecisions-production)
   - [AIMetrics](#18-valleyeats-aimetrics-production)
   - [AIWebSocketConnection](#19-valleyeats-aiwebsocketconnection-production)
   - [DispatchConnections](#20-valleyeats-dispatchconnections)
   - [DispatchActivityLogs](#21-valleyeats-dispatchactivitylogs)
   - [DispatchAiToolFeedback](#22-valleyeats-dispatchaitooolfeedback)
6. [Market Intelligence Tables](#market-intelligence-tables)
   - [MarketMeters](#23-valleyeats-marketmeters)
   - [DemandPredictions](#24-valleyeats-demandpredictions)
   - [DriversDemand](#25-valleyeats-driversdemand)
   - [WeatherData](#26-valleyeats-weatherdata)
   - [RestaurantHealthCache](#27-valleyeats-restauranthealthcache)
   - [RestaurantIntelligenceReports](#28-valleyeats-restaurantintelligencereports)
7. [Communication Tables](#communication-tables)
   - [MessageHistory](#29-valleyeats-messagehistory)
   - [Alerts](#30-valleyeats-alerts)
8. [Financial Tables](#financial-tables)
   - [Transactions](#31-valleyeats-transactions)
9. [Vendor Portal Tables](#vendor-portal-tables)
   - [VendorActivityLogs](#32-valleyeats-vendoractivitylogs)
   - [MenuItems](#33-valleyeats-menuitems)
   - [Menus](#34-valleyeats-menus)
10. [Additional Tables (Catalogued)](#additional-tables-catalogued)
11. [Key Relationships & Foreign Keys](#key-relationships--foreign-keys)
12. [Ontology Design Implications](#ontology-design-implications)

---

## Overview & Statistics

| Metric | Value |
|--------|-------|
| Total ValleyEats tables | ~95+ (including `ve-*` prefixed) |
| Dispatch-relevant tables | ~32 (documented below) |
| Total order records | ~1,373,802 |
| Total driver records | ~748 |
| Total restaurant records | ~563 |
| Total user records | ~91,690 |
| Total issue/ticket records | ~212,815 |
| AI decision records | ~699,485 |
| AI metric records | ~3,225,709 |
| All tables use | PAY_PER_REQUEST billing |
| Streams enabled on | Most core tables (NEW_AND_OLD_IMAGES) |

---

## Core Entity Tables

### 1. ValleyEats-Orders

The central table. Every delivery/takeout order with full lifecycle timestamps.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `OrderId` | S (UUID) |

**Global Secondary Indexes (11):**

| GSI Name | Partition Key | Sort Key | Projection |
|----------|--------------|----------|------------|
| `OrderStatus-DriverId-index` | OrderStatus | DriverId | ALL |
| `LambdaDispatch-index` | OrderDate | OrderReadyTime | ALL |
| `OrderIdKey-index` | OrderIdKey | - | ALL |
| `OrderStatus-OrderReadyTime-index` | OrderStatus | OrderReadyTime | ALL |
| `OrderId-index` | OrderId | - | ALL |
| `DriverId-OrderReadyTime-index` | DriverId | OrderReadyTime | ALL |
| `RestaurantId-index` | RestaurantId | OrderReadyTime | ALL |
| `DeliveryZone-OrderReadyTime-index` | DeliveryZone | OrderReadyTime | ALL |
| `ExtraDriverId-index` | ExtraDriverId | OrderReadyTime | ALL |
| `UserId-index` | UserId | OrderCreatedTime | ALL |
| `OrderType-OrderStatus-index` | OrderType | OrderStatus | ALL |

**Sample Item Structure:**
```
{
  // Identity
  OrderId: "5727b0c4-9ef0-4cc0-899d-71ea853aa879"      // UUID, PK
  OrderIdKey: "5727b0c4"                                  // Short ID for human reference

  // Lifecycle timestamps (Unix epoch seconds)
  OrderCreatedTime: 1717797194          // Customer created order
  OrderPlacedTime: 1717797384           // Payment confirmed
  OrderConfirmedNotifiedTime: 1717797562 // Restaurant notified
  DriverAssignedTime: 1717797386        // Driver assigned
  DeliveryConfirmedTime: 1717797702     // Restaurant confirmed order
  OrderReadyTime: 1717799120            // Food is ready
  WaitingForOrderTime: 1717798320       // Driver waiting at restaurant
  OrderInBagTime: 1717799291            // Order bagged
  EnrouteTime: 1717798317               // Driver heading to restaurant
  OrderInTransitTime: 1717799316        // On the way to customer
  AtCustomerTime: 1717799484            // Arrived at customer
  OrderDeliveredTime: 1717799511        // Delivered

  // Status & Type
  OrderStatus: "Completed"              // Values: Completed, Cancelled, Pending, etc.
  OrderType: "Delivery"                 // Values: Delivery, Takeout
  ASAP: true                            // Boolean - immediate order flag

  // Participants
  UserId: "user@example.com"            // Customer email (PK of Users table)
  DriverId: "driver@example.com"        // Driver email (PK of Drivers table)
  RestaurantId: "ad629f51-..."          // UUID (PK of Restaurants table)
  RestaurantName: "The Locks Perth"     // Denormalized restaurant name

  // Delivery details
  DeliveryZone: "Perth"                 // Market/zone name
  DeliveryStreet: "38 Arthur St"
  DeliveryCity: "Perth"
  DeliveryProvince: "ON"
  DeliveryType: "Leave at door"         // Values: "Leave at door", "Hand delivered"
  DeliveryInstructions: "..."
  DeliveryDistance: 1300                 // Meters
  DeliveryFee: 400                      // Cents
  DeliveryCredit: 0                     // Cents
  DeliveryAdjustment: 51                // Cents

  // Financials (all in CENTS)
  OrderSubtotal: 4600
  Tax: 717
  Taxes: { PST: 0, HST: 717, GST: 0, QST: 0 }
  ConvenienceFee: 518
  Tip: 460
  OrderTotal: 6695
  ChargeValue: 6695
  ChargeId: "ch_3PPAlnBFhoH7qt3m0pEuDoRU"  // Stripe charge ID
  GasAdjustment: 51
  Commission: 0.87                      // Decimal percentage
  PerksPointsEarned: 230
  PerksPointsUsed: 0
  PerksPointsDiscount: 0

  // Geo
  CustomerLocation: { latitude: 44.893648, longitude: -76.247173 }
  OrderLocation: { latitude: 44.893656, longitude: -76.24686 }

  // Timing metrics
  TravelTime: 477                       // Seconds
  EnrouteDuration: 184                  // Seconds

  // Flags
  Alcohol: false
  Cannabis: false
  WithDriver: true
  DeliveryConfirmed: true
  VED: false                            // ValleyEats Direct
  IgnoreDispatch: true                  // Skip auto-dispatch
  BaseDeliveryCredit: false

  // Order items (embedded list of maps)
  OrderItems: [
    {
      ItemId: "10594197-...",
      ItemName: "Sausage & Shrimp Penne",
      Description: "...",
      Price: 3300,                      // Cents
      Quantity: 1,
      Cuisine: "American",
      MenuOptions: { ... },             // Nested modifier selections
      Taxable: true,
      Alcohol: false,
      Cannabis: false,
      DaysAvailable: [0,1,2,3,4,5,6],
      AvailabilityStart: 1020,          // Minutes from midnight
      AvailabilityEnd: 1320,
      PrepTime: -1,
      OrderLimit: -1
    }
  ]

  // Communication
  OrderMessageSent: "Our apologies..."      // Message sent to customer
  RestaurantMessageSent: "Our driver is..." // Message sent to restaurant

  // Delivery proof
  Photo: "https://valleyeats-drivers-pics.s3.amazonaws.com/..."

  // Event tracking
  EventLocks: ["Order-Completed"]

  // Push notification
  EndpointArn: "arn:aws:sns:..."

  PlaceSettings: 0
}
```

**Key Observations:**
- All monetary values in **cents** (integers)
- All timestamps in **Unix epoch seconds**
- Hours in **minutes from midnight** (e.g., 1020 = 5:00 PM)
- `OrderIdKey` is the first 8 chars of the UUID (human-friendly short code)
- `DeliveryZone` is the market name (e.g., "Pembroke", "Perth")
- `UserId` and `DriverId` are **email addresses**, not UUIDs
- Streams enabled with NEW_AND_OLD_IMAGES for event processing

---

### 2. ValleyEats-Drivers

Active courier/driver roster with real-time status.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `DriverId` | S (email address) |

**GSIs:**

| GSI Name | Partition Key | Projection |
|----------|--------------|------------|
| `DeliveryZone-index` | DeliveryZone | ALL |
| `DispatchZone-index` | DispatchZone | ALL |

**Sample Item Structure:**
```
{
  // Identity
  DriverId: "driver@example.com"           // Email as PK
  FullName: "Jacques Ethier Masson"
  Phone: "(613) XXX-XXXX"
  AgentId: "189a8e7d-..."                  // UUID for internal reference

  // Zone assignment
  DispatchZone: "Petawawa"                 // Current dispatch zone
  DeliveryArea: "Petawawa"                 // Assigned delivery area
  OriginalDeliveryArea: "Petawawa"         // Original assignment

  // Real-time status
  Available: false                         // Currently accepting orders
  Paused: false                            // Temporarily paused
  Active: false                            // Employment status
  ignoreArea: false                        // Can deliver outside zone

  // Device info
  AppVersion: "2.6.2"
  phoneModel: "iPhone13,4"
  phoneOS: "iOS 16.2"
  phoneCarrier: "Rogers"
  ConnectionId: "AgJLecHKoAMCFTw="        // WebSocket connection

  // App permissions
  AppSetting: {
    Camera: "Full",
    GeoLocate: "Partial",                  // Values: Full, Partial, No
    Microphone: "No",
    Phone: "Full",
    Speech: "No"
  }

  // Push notifications
  DriverArn: "arn:aws:sns:..."

  // Training
  TrainingOrders: 25                       // Number of training orders

  // Authentication
  TempPass: "..."                          // Temporary password
  Monacher: "???"                          // Unknown field
}
```

**Key Observations:**
- Only ~748 drivers total (small fleet, regional service)
- Two zone concepts: `DeliveryZone` (customer-facing) and `DispatchZone` (operations)
- Real-time `Available`/`Paused` status tracked directly on the record
- WebSocket `ConnectionId` for real-time push
- `DriverId` is email address (used as FK in Orders, Messages, etc.)

---

### 3. ValleyEats-Restaurants

Partner restaurant information, menus, hours, and operational configuration.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `RestaurantId` | S (UUID) |

**GSIs:**

| GSI Name | Partition Key | Projection |
|----------|--------------|------------|
| `DeliveryZone-index` | DeliveryZone | ALL |
| `ShopUrl-index` | ShopUrl | ALL |
| `RestaurantIdKey-index` | RestaurantIdKey | INCLUDE(RestaurantId) |

**Sample Item Structure:**
```
{
  // Identity
  RestaurantId: "a166e272-c622-4879-9036-9a629abd17df"   // UUID PK
  RestaurantIdKey: "a166e272"                              // Short ID
  RestaurantName: "Kelsey's"
  Restaurant: true                                         // Active flag

  // Location
  City: "Petawawa"
  Province: "ON"
  DeliveryZone: "Pembroke"                                 // Market zone

  // Contact
  ContactName: "Brittany / Kevin - GM / Peter - Owner"
  Phone: "(613) XXX-XXXX"
  Email: "restaurant@example.com"
  OtherEmailAddresses: ["manager@example.com"]
  AccountingEmailAddresses: ["accounting@example.com"]

  // Cuisine & Display
  PrimaryCuisine: "Pub"
  Featured: false
  Likes: 15
  Price: 2                                                // Price level (1-3)

  // Menu structure
  MenuSections: ["Bundles", "Appetizers", "Burly Burgers", ...]
  MenuSectionPhotos: { "Happy Meals": "https://s3...", ... }

  // Operating hours (minutes from midnight)
  KitchenHours: {
    Mon: { open: 660, closed: 1320 },                    // 11:00 AM - 10:00 PM
    Tue: { open: 660, closed: 1320 },
    ...
  }
  DefaultHours: {
    Mon: { open: 720, closed: 1260 },                    // 12:00 PM - 9:00 PM
    ...
  }

  // Financials
  Commission: 0.87                                        // Platform commission rate
  Taxes: { HST: 0.13 }
  PayoutMethod: "direct deposit"

  // Delivery config
  DeliveryAvailable: true
  DeliveryInstructions: "Please pick up from the table..."
  POSETA: 30                                              // POS estimated time of arrival (minutes)

  // Hardware/Device
  HasPrinter: true
  BatteryCharging: false
  SerialNumber: "VB5521A520145"
  TabletOS: "Android 7.1.1"
  NetworkType: "wifi"
  POSDeviceToken: "f2FiM4aX19Q:..."
  LastHeartbeat: 1774451924                               // Unix timestamp
  POSMigrationLastRequest: 1774279716

  // Access control
  Permissiongroup: {
    Manager: { Orders: true, Reports: true, Campaign: true, Menu: true, Message: true },
    Employee: { Orders: true, Reports: true, Campaign: true, Menu: true, Message: true }
  }
  Links: { "e4635cfadac544ce": { redeemed: false, position: "Owner" } }
}
```

**Key Observations:**
- ~563 restaurants (regional service)
- Hours stored as **minutes from midnight** (660 = 11:00 AM)
- `LastHeartbeat` tracks whether the restaurant's tablet is online
- Commission rate stored per-restaurant (0.87 = 87%)
- `POSETA` is the estimated prep time in minutes
- Menu structure is denormalized with sections/photos embedded

---

### 4. ValleyEats-Users

Customer accounts.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `Email` | S (email address) |

**GSIs:**

| GSI Name | Partition Key | Projection |
|----------|--------------|------------|
| `UserIdKey-index` | UserIdKey | ALL |
| `Phone-index` | Phone | ALL |
| `CustomerId-index` | CustomerId | ALL |

**Sample Item Structure:**
```
{
  // Identity
  Email: "user@example.com"                // PK
  UserIdKey: "user@example.com"            // Same as email (legacy duplication)
  FullName: "Ricard Walsh"
  Phone: "(705) XXX-XXXX"
  CustomerId: "cus_SctjAaJs0q8lPB"        // Stripe customer ID
  Created: 1751752095                      // Unix timestamp

  // Delivery addresses (saved list)
  DeliveryAddresses: [
    {
      DeliveryStreet: "1033 Waterloo St.",
      DeliveryCity: "Port Elgin",
      DeliveryProvince: "ON",
      DeliveryCountry: "CA",
      DeliveryPostal: "N0H 2C3",
      DeliveryLat: 44.448693,
      DeliveryLng: -81.383618,
      DeliveryAptNo: "115",
      DeliveryInstructions: "buzzer #115",
      DeliveryType: "Hand delivered"
    }
  ]

  // Payment
  CardLabel: "MasterCard 0551"

  // Loyalty
  PerksPoints: 990
  BaseDeliveryCredits: 0
  NewUserPromo: -1                         // -1 = used, 0 = unused

  // Preferences
  OrderSms: true
  OrderEmails: false
  Unsubscribed: { campaign: "all", time: 1762219535 }
  Favourites: {}

  // Device
  AppVersion: "3.4.3"
  VersionCode: 336
  phoneModel: "iPhone14,7"
  phoneOS: "iOS 26.3"
  phoneCarrier: "--"
  UserArn: "arn:aws:sns:..."              // Push notification endpoint
  ForceLogout: 1765503600                 // Force re-authentication timestamp

  // In-app messages from support
  Messages: [
    {
      message: "Your courier is on the way...",
      sent: 1771201082,
      isread: false,
      IssueId: "557c0a7f"                // Optional link to support issue
    }
  ]
}
```

**Key Observations:**
- ~91,690 users
- `Email` is the PK (not a UUID)
- `CustomerId` is the Stripe customer ID for payment
- In-app messages embedded directly in the user record
- Multiple saved delivery addresses with lat/lng

---

### 5. ValleyEats-Employees

Internal staff accounts for the dispatch/support system.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `Email` | S |
| SK (RANGE) | `Title` | S |

**Key Observations:**
- ~83 employees
- Composite key: Email + Title (one person can have multiple roles)
- Used for dispatch agents, support staff, managers

---

## Driver Operations Tables

### 6. ValleyEats-DriverShifts

Scheduled driver shifts by market.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `DriverId` | S (email) |
| SK (RANGE) | `shiftstart` | N (Unix epoch) |

**GSIs:**

| GSI Name | Partition Key | Sort Key | Projection |
|----------|--------------|----------|------------|
| `date-index` | shiftdate | shiftstart | ALL |
| `Market-index` | Market | shiftstart | ALL |

**Sample Item:**
```
{
  DriverId: "driver@example.com",
  shiftstart: 1760882400,              // Unix epoch
  shiftend: 1760904000,                // Unix epoch
  shiftdate: "2025-10-19",             // ISO date string
  Market: "PortElgin",
  area: "PortElgin"
}
```

**Key Observations:**
- ~88,365 shift records
- `shiftstart`/`shiftend` in Unix epoch seconds
- `shiftdate` as ISO date string for human queries
- `Market` and `area` appear to be the same value (market/zone)

---

### 7. ValleyEats-DriverAvailability

Driver self-reported availability windows (different from scheduled shifts).

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `DriverId` | S (email) |
| SK (RANGE) | `availstart` | N (Unix epoch) |

**Sample Item:**
```
{
  DriverId: "driver@example.com",
  availstart: 1730638800,              // Unix epoch
  availend: 1730692800,                // Unix epoch
  availdate: "2024-11-03",            // ISO date
  available: true,                     // Is actually available
  allDay: false                        // Not all-day availability
}
```

**Key Observations:**
- ~98,040 availability records
- Separate from shifts -- this is driver-declared availability
- `available` flag (can be false to mark "unavailable" blocks)

---

### 8. ValleyEats-DriverMessages

Dispatch-to-driver chat messages.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `DriverId` | S (email) |
| SK (RANGE) | `ts` | N (Unix epoch) |

**GSIs:**

| GSI Name | Partition Key | Sort Key | Projection |
|----------|--------------|----------|------------|
| `MessageDate-ts-index` | MessageDate | ts | ALL |

**Sample Item:**
```
{
  DriverId: "relations@valleyeats.ca",    // Recipient driver
  ts: 1690299295,                          // Timestamp
  Message: "Hi Steph",
  Author: "Sydney Larocque",               // Staff member who sent it
  Colour: "#b896b7"                        // Author's color in chat UI
}
```

**Key Observations:**
- ~1,046,327 messages (heavy usage)
- Messages TO drivers from dispatch/support staff
- `Author` is human-readable name (not an email/ID)
- `Colour` for chat UI rendering

---

### 9. ValleyEats-DriverLatestMessage

Cache of most recent message per driver conversation.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `DriverId` | S (email) |

**Sample Item:**
```
{
  DriverId: "driver@example.com",
  ts: 1702303195,
  Message: "Hey Chelsea, are you available for a shift today at around 11?",
  Author: "Bethany Evans",
  Colour: "#79a763",
  Opened: 1692383897                   // Last opened timestamp (optional)
}
```

---

### 10. ValleyEats-DriverPoints

Driver performance/loyalty points tracked by time interval.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `DriverId` | S (email) |
| SK (RANGE) | `Interval` | S (e.g., "2021-06" or "2021-06-05") |

**GSIs:**

| GSI Name | Partition Key | Sort Key | Projection |
|----------|--------------|----------|------------|
| `Ranking-index` | Interval | PointTotal | KEYS_ONLY |
| `Interval-index` | Interval | PointTotal | ALL |

**Sample Item:**
```
{
  DriverId: "driver@example.com",
  Interval: "2021-06",                  // Monthly or daily granularity
  PointTotal: -210,                     // Net score (can be negative!)

  // Point breakdown
  OrderPoints: 140,                     // Points from completing orders
  WorkShiftPoints: 0,                   // Points from working shifts
  DropShiftPoints: -440,                // PENALTY for dropping shifts
  RatingPoints: 50,                     // Customer rating bonus
  DistancePoints: 0,                    // Long-distance bonus
  LatePoints: 40,                       // Late delivery penalty

  // Activity counts
  Orders: 4,
  WorkShifts: 5,
  DropShifts: 5                         // Dropped shifts count
}
```

**Key Observations:**
- ~59,017 records
- `Interval` can be monthly ("2021-06") or daily ("2021-06-05")
- Points can go negative (penalties for dropping shifts)
- Ranking GSI enables leaderboard queries

---

### 11. ValleyEats-DriverBans

Banned drivers and banned customer-driver combinations.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `DriverId` | S (email) |

**Sample Item:**
```
{
  DriverId: "driver@example.com",
  Customers: ["customer@example.com"]    // List of banned customers
}
```

**Key Observations:**
- ~933 records
- Tracks which customers a driver is banned from serving
- Empty `Customers` list means the driver exists in bans table but has no customer bans

---

### 12. ValleyEats-DriverLocationHistory

GPS tracking history per order per driver.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `OrderId` | S (UUID) |
| SK (RANGE) | `DriverId` | S (email) |

**Sample Item:**
```
{
  OrderId: "b48fb72f-...",
  DriverId: "driver@example.com",
  CreatedAt: 1773355727,
  LastUpdated: 1773356112,
  ExpiresAt: 1774565712,                 // TTL for auto-deletion
  LocationHistory: [
    { Timestamp: 1773355727, Location: { latitude: 44.899806, longitude: -76.020386 } },
    { Timestamp: 1773355737, Location: { latitude: 44.89972, longitude: -76.020507 } },
    // ~10 second intervals, dozens of points per delivery
  ],
  NotificationHistory: []
}
```

**Key Observations:**
- ~537 records (relatively new table, 2025)
- Location sampled every ~10 seconds during active delivery
- TTL-based expiry (`ExpiresAt`) for GDPR/data retention
- Keyed by Order+Driver (one record per delivery)

---

### 13. ValleyEats-OpenShifts

Available shifts that drivers can claim.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `ShiftId` | S (UUID) |

**GSIs:**

| GSI Name | Partition Key | Sort Key | Projection |
|----------|--------------|----------|------------|
| `Market-index` | Market | shiftstart | ALL |

**Sample Item:**
```
{
  ShiftId: "5A8718AA-F456-461D-88AC-25479D665B76",
  Market: "Casselman",
  area: "Casselman",
  shiftstart: 1771362000,
  shiftend: 1771376400,
  Type: "ADMIN",                          // Values: "ADMIN", "DROP"
  Active: true,
  Clone: false,
  Redemptions: 1                          // Number of times claimed
}
```

**Key Observations:**
- ~19,252 open shift records
- `Type`: "ADMIN" (created by admin) vs "DROP" (dropped by another driver)
- `Clone` indicates if this is a recurring/cloned shift
- `Redemptions` tracks how many times a shift has been claimed

---

## Support & Issues Tables

### 14. ValleyEats-IssueTracker

Customer support tickets and internal operational issues.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `IssueId` | S (short hash, e.g., "b04b887b") |

**GSIs:**

| GSI Name | Partition Key | Sort Key | Projection |
|----------|--------------|----------|------------|
| `Originator-Created-index` | Originator | Created | ALL |
| `IssueStatus-Created-index` | IssueStatus | Created | ALL |
| `OrderIdKey-Created-index` | OrderIdKey | Created | ALL |

**Sample Item (Customer Issue):**
```
{
  IssueId: "b04b887b",
  Category: "Order Issue",                // Values: "Order Issue", "Driver Issue"
  IssueType: "Other",                     // Values: "Other", "Cancel Order", "Stale Driver Location", etc.
  IssueStatus: "Resolved",                // Values: "New", "Pending", "Resolved", "Closed"
  Created: 1666389297,                    // Unix timestamp

  // Linked entities
  OrderId: "155c716e-...",
  OrderIdKey: "155c716e",
  RestaurantId: "5d941685-...",
  RestaurantName: "Greco Xpress",
  DriverId: "driver@example.com",
  Market: "Pembroke",

  // People
  Originator: "customer@example.com",     // Who filed the issue
  Owner: "agent@example.com",             // Assigned agent

  // Content
  Description: "We ordered for delivery at 6pm...",
  Resolution: "order delivered",

  // Action log
  Actions: [
    {
      Timestamp: 1666389316,
      Actor: "Erin Winchester",
      Description: "set the issue owner to agent@example.com"
    },
    {
      Timestamp: 1666389318,
      Actor: "Erin Winchester",
      Description: "set the issue status to Pending"
    }
  ],

  // Chat messages between customer and support
  Messages: [
    {
      Message: "Hello, we apologise for the delay...",
      Originator: "agent@example.com",
      Send: 1666389400
    },
    {
      Message: "Ok, my screen still says...",
      Originator: "customer@example.com",
      Send: 1666389608,
      Read: 1666389825                     // Optional read receipt
    }
  ],

  // Internal notes
  Notes: [
    {
      Author: "Erin Winchester",
      Timestamp: 1666389333,
      Note: "order picked up"
    }
  ],

  // Push notification
  EndpointArn: "arn:aws:sns:..."
}
```

**Sample Item (System-Generated Issue):**
```
{
  IssueId: "303E550A",
  Category: "Driver Issue",
  IssueType: "Stale Driver Location",     // Auto-detected
  IssueStatus: "Closed",
  Created: 1674687965,
  Originator: "Supervisor",               // System-generated
  Owner: "Unassigned",
  DriverId: "driver@example.com",
  Market: "Pembroke",
  Description: "A driver's (driver@example.com) location is not updating."
}
```

**Key Observations:**
- ~212,815 issues (massive support history)
- Mix of customer-filed and system-generated issues
- `Originator` can be an email (customer) or "Supervisor" (system)
- Full conversation thread embedded in `Messages` array
- `Actions` tracks status changes and assignments
- Highly relevant for AI dispatcher -- needs to read/create/manage issues

---

### 15. ValleyEats-Disputes

Formal disputes (refund requests, complaints). Newer/more structured than IssueTracker.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `IssueId` | S |
| SK (RANGE) | `CreatedTimestamp` | N |

**GSIs:**

| GSI Name | Partition Key | Sort Key | Projection |
|----------|--------------|----------|------------|
| `OrderId-CreatedTimestamp-index` | OrderId | CreatedTimestamp | ALL |
| `AssignedTo-CreatedTimestamp-index` | AssignedTo | CreatedTimestamp | ALL |
| `RestaurantId-CreatedTimestamp-index` | RestaurantId | CreatedTimestamp | ALL |
| `Status-CreatedTimestamp-index` | Status | CreatedTimestamp | ALL |
| `CustomerId-CreatedTimestamp-index` | CustomerId | CreatedTimestamp | ALL |

**Sample Item:**
```
{
  IssueId: "DISP-2025-002",
  CreatedTimestamp: 1735837200,

  DisputeType: "FOOD_QUALITY",            // Values: FOOD_QUALITY, BILLING_ERROR
  Status: "IN_PROGRESS",                  // Values: PENDING, IN_PROGRESS, RESOLVED
  Priority: "MEDIUM",                     // Values: HIGH, MEDIUM, LOW

  Title: "Food arrived cold and incorrect items",
  Description: "Order arrived 45 minutes late...",
  Amount: 28.75,                          // Dollar amount in dispute (NOT cents)

  // Linked entities
  OrderId: "ORDER-123789",
  RestaurantId: "REST-234",
  CustomerId: "CUST-67890",
  AssignedTo: "manager@valleyeats.com",
  UpdatedBy: "manager@valleyeats.com",
  LastUpdated: 1735838400,
  Resolution: "",

  // Structured history
  History: [
    { Action: "DISPUTE_CREATED", Details: "...", Timestamp: ..., UserType: "CUSTOMER", UserId: "..." },
    { Action: "ASSIGNED", Details: "...", Timestamp: ..., UserType: "SUPPORT", UserId: "..." },
    { Action: "STATUS_CHANGED", Details: "...", Timestamp: ..., UserType: "MANAGER", UserId: "..." }
  ],

  // Messages
  Messages: [
    { MessageId: "MSG-003", Content: "...", SenderType: "CUSTOMER", SenderId: "...", Timestamp: ..., IsRead: true }
  ],

  // Internal notes
  Notes: [
    { NoteId: "NOTE-002", Content: "...", UserType: "MANAGER", UserId: "...", Timestamp: ..., IsInternal: true }
  ]
}
```

**Key Observations:**
- Only ~3 records (very new table, 2025)
- More structured than IssueTracker (has Priority, DisputeType, structured History)
- Amount is in **dollars** (not cents -- different from Orders!)
- `IsInternal` flag on notes (customer-visible vs internal)

---

### 16. ValleyEats-OrderErrors

Tracked delivery errors and their resolutions.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `OrderId` | S (UUID) |
| SK (RANGE) | `ts` | N (Unix epoch) |

**GSIs:**

| GSI Name | Partition Key | Sort Key | Projection |
|----------|--------------|----------|------------|
| `ErrorId-index` | ErrorId | ts | ALL |
| `ErrorSource-index` | ErrorSource | CompletedTime | ALL |

**Sample Item:**
```
{
  OrderId: "f88ca545-...",
  ts: 1738272231,
  ErrorId: "support@valleyeats.ca",        // Who flagged the error
  ErrorType: "High Delay (VE)",            // Values: "High Delay (VE)", "Ignored Instructions (Rest)"
  ErrorSource: "ValleyEats",               // Values: "ValleyEats", "Restaurant"
  ErrorValue: 3016,                        // Magnitude (e.g., seconds of delay)
  Resolution: "Penalized",                 // Values: "Penalized", "Refund"
  zone: "Arnprior",
  CompletedTime: 1738178063
}
```

**Key Observations:**
- ~16,045 errors tracked
- `ErrorSource` distinguishes VE vs Restaurant fault
- `ErrorValue` appears to be the severity metric (e.g., delay in seconds)
- `ErrorId` can be a user email (who flagged) or a UUID

---

## AI & Dispatch Tables

### 17. ValleyEats-AIDecisions-production

AI dispatch analysis snapshots and decisions. **This is the predecessor to Sisyphus.**

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `date` | S (ISO date, e.g., "2025-09-29") |
| SK (RANGE) | `timestamp` | N (Unix epoch) |

**Sample Item (truncated):**
```
{
  date: "2025-09-29",
  timestamp: 1759118411,
  decisionId: "DispatchSnapshotAnalysis-1759118411-ss3yhf",
  version: "3.2",
  shadowMode: true,                        // Running in shadow mode (not taking action)

  analysis: {
    marketResults: [
      {
        market: "Arnprior",
        rawIssuesDetected: 0,
        decisions: [],
        downstreamActions: [],
        marketMetrics: {
          highPriorityCount: 0,
          utilizationRate: 1,
          avgOrdersPerDriver: 0,
          issueReductionRate: 0
        }
      },
      // ... one entry per market
    ]
  }
}
```

**Key Observations:**
- ~699,485 decision records (11.3 GB!) -- very high volume
- Keyed by date + timestamp for time-series queries
- `shadowMode: true` means the AI was observing, not acting
- Per-market metrics: utilization rate, priority counts, issue reduction
- `decisionId` format: `{AnalysisType}-{timestamp}-{random}`
- This is the existing AI system that Sisyphus will replace/enhance

---

### 18. ValleyEats-AIMetrics-production

Granular AI operational metrics (shadow actions, performance tracking).

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `metricId` | S |

**GSIs:**

| GSI Name | Partition Key | Projection |
|----------|--------------|------------|
| `TimestampIndex` | timestamp | ALL |

**Sample Item:**
```
{
  metricId: "shadow_action-1760738818-hb4h4o",
  timestamp: 1760738818,
  date: "2025-10-17",
  ttl: 1763330818,                         // Auto-expire after ~30 days
  metricType: "shadow_action",

  data: {
    action: "operations_call_couriers",     // The action the AI would take
    timestamp: 1760738818,
    details: {
      type: "operations_call_couriers",
      issueType: "courier_not_accepting",
      severity: "critical",
      priority: "critical",
      orderId: "3ba058e0-...",
      timeout: 60,                          // Seconds before escalation
      details: {
        alertType: "critical_unaccepted_order",
        urgencyLevel: "immediate",
        message: "Operations team to contact top couriers immediately",
        contactMethod: "phone_call"
      }
    }
  }
}
```

**Another Sample (reassignment):**
```
{
  metricId: "shadow_action-1763768410-2fapp5",
  metricType: "shadow_action",
  data: {
    action: "reassign_if_available",
    details: {
      issueType: "pickup_delay",
      severity: "high",
      priority: "urgent",
      orderId: "3b980d66-...",
      currentDriverId: "driver1@example.com",
      targetDriverId: "driver2@example.com",
      timeout: 180,
      details: {
        requiresAvailableDriver: true,
        availableDrivers: 10,
        canReassign: true,
        message: "reassign if available for order",
        reassignmentType: "reassign_if_available",
        timeBufferSeconds: 300
      }
    }
  }
}
```

**Key Observations:**
- ~3,225,709 metrics (very high volume, 1.2 GB)
- TTL-based auto-expiry (~30 days)
- Action types observed:
  - `operations_call_couriers` -- escalate to ops for phone calls
  - `reassign_if_available` -- reassign order to different driver
- Severity levels: `critical`, `high`, `medium`
- Priority levels: `critical`, `urgent`
- This is the **exact action vocabulary Sisyphus needs to support**

---

### 19. ValleyEats-AIWebSocketConnection-production

WebSocket connections for the AI dispatch real-time interface.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `connectionId` | S |

**Key Observations:**
- Currently 0 items (not actively in use)
- Existed since 2025-08 -- likely the old AI system's WebSocket
- Sisyphus will need its own connection management

---

### 20. ValleyEats-DispatchConnections

WebSocket connections for the dispatch dashboard.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `ConnectionId` | S |

**Key Observations:**
- Currently 0 items (transient -- connections come and go)
- Created 2026-02-11 (recent, part of the new dispatch system)
- This is the Sisyphus-era connection table

---

### 21. ValleyEats-DispatchActivityLogs

Audit trail for dispatch dashboard actions (who did what, when).

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `Date` | S (ISO date) |
| SK (RANGE) | `LogId` | S (composite: "{ISO timestamp}#{UUID}") |

**GSIs (7):**

| GSI Name | Partition Key | Sort Key | Projection |
|----------|--------------|----------|------------|
| `AgentIndex` | AgentId | Timestamp | ALL |
| `MarketIndex` | MarketId | Timestamp | ALL |
| `IssueIndex` | IssueId | Timestamp | ALL |
| `OrderIndex` | OrderId | Timestamp | ALL |
| `RestaurantIndex` | RestaurantId | Timestamp | ALL |
| `DriverIndex` | DriverId | Timestamp | ALL |
| `InsightIndex` | InsightId | Timestamp | ALL |

**Sample Item:**
```
{
  Date: "2026-02-13",
  LogId: "2026-02-13T12:53:00.890Z#ddb05356-df6f-4454-88ec-d0974452df7b",

  // Action details
  Action: "CONVERSATION_READ",             // What happened
  Category: "messages",                    // Action category
  Success: true,
  ErrorMessage: null,

  // Who
  AgentId: "d7ff38db-...",
  AgentEmail: "nick@valleyeats.ca",
  AgentPosition: "General Software Developer",

  // What entity
  DriverId: "driver@example.com",

  // Request context
  RequestId: "10b443b1-...",
  IpAddress: "76.67.59.69",
  UserAgent: "Mozilla/5.0...",
  Timestamp: "2026-02-13T12:53:00.890Z",

  // Additional details (flexible)
  Details: { driverId: "driver@example.com" }
}
```

**Key Observations:**
- Only 4 records (brand new table, 2026-02-12)
- **7 GSIs** for querying by any entity (agent, market, issue, order, restaurant, driver, insight)
- This is the audit trail Sisyphus should log to
- Action types observed: `CONVERSATION_READ`
- Tracks agent position/role for access control analytics

---

### 22. ValleyEats-DispatchAiToolFeedback

Human feedback on AI-generated responses (message enhancement tool).

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `Id` | S (timestamp string) |

**GSIs:**

| GSI Name | Partition Key | Sort Key | Projection |
|----------|--------------|----------|------------|
| `assistant-index` | assistantUsed | Id | ALL |

**Sample Item:**
```
{
  Id: "1749664407",                        // Timestamp as string

  // Tool info
  AssistantUsed: "Enhance Message Tool",

  // Agent info
  UserEmail: "agent@example.com",
  UserTitle: "Dispatch Analyst",

  // Context
  IssueId: "8cc1d03e",
  OriginalMessage: "Issue Summary:\nID: 8cc1d03e\nCategory: Order Issue\nType: Cancel Order\n...",

  // Human agent's draft response
  UserResponse: "Hi there, I've gone ahead and cancelled the order for you",

  // AI-enhanced version that was sent
  ResponseSent: "Hi Joey, your order has been successfully cancelled as requested. If you need any further assistance...",

  // AI's raw response (if different)
  AiActualResponse: "",

  // Feedback
  Status: "positive",                     // positive/negative
  Rating: 5,                              // 1-5 scale
  Comments: ""
}
```

**Key Observations:**
- ~6,749 feedback records
- Tracks human-in-the-loop AI message enhancement
- Captures the full context (issue summary, timing details)
- 1-5 rating scale + positive/negative status
- `AssistantUsed` identifies which AI tool was used
- Valuable training data for Sisyphus message generation

---

## Market Intelligence Tables

### 23. ValleyEats-MarketMeters

Real-time market health/demand scores.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `Market` | S |

**Sample Item:**
```
{
  Market: "Stittsville",
  Score: 100,                             // Health score (0-100)
  idealDrivers: 3,                        // How many drivers are needed
  drivers: 0,                             // How many are available
  ts: 1774452009                          // Last updated timestamp
}
```

**Key Observations:**
- ~22 markets tracked
- Real-time snapshot (single record per market, constantly updated)
- `Score` indicates market health (100 = critical need, low = oversupplied)
- `idealDrivers` vs `drivers` gap = dispatch urgency signal

---

### 24. ValleyEats-DemandPredictions

ML-generated driver demand forecasts by market and time slot.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `MarketWeek` | S (e.g., "embrun#W2#2026") |

**Sample Item:**
```
{
  Market: "Embrun",
  MarketWeek: "embrun#W2#2026",

  Metadata: {
    model_confidence: "high",
    prediction_period: "2026-W2",
    training_data_points: 2066,
    generated_at: "2026-01-06T19:24:32.549469"
  },

  Predictions: [
    {
      date: "2026-01-06",
      day_of_week: "Tuesday",
      time: "20:00",
      ds: "2026-01-06 20:00:00",
      drivers_predicted: 2,
      drivers_min: 1,
      drivers_max: 2
    },
    // ... multiple time slots per day
  ]
}
```

**Key Observations:**
- ~574 prediction records
- Composite key format: `{market}#W{week}#{year}`
- Predictions include confidence intervals (min/max)
- Generated by ML model with confidence scoring
- Critical input for Sisyphus shift planning recommendations

---

### 25. ValleyEats-DriversDemand

Historical demand tracking by market and pay week.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `Market` | S |
| SK (RANGE) | `PayWeekInterval` | S (e.g., "2026-W09") |

**Sample Item:**
```
{
  Market: "Stittsville",
  PayWeekInterval: "2026-W09",
  DemandHistory: {
    "1430-1500#TUE": {                     // Time slot + day
      "20260224": {                        // Date
        NoDriversAbandonments: 1           // Orders abandoned due to no drivers
      }
    }
  }
}
```

**Key Observations:**
- ~956 records
- Tracks unfulfilled demand by time slot
- `NoDriversAbandonments` = orders lost because no driver was available
- Key metric for Sisyphus to use in shift optimization

---

### 26. ValleyEats-WeatherData

Historical and forecast weather data by market.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `Market` | S |
| SK (RANGE) | `ts` | N (Unix epoch) |

**Sample Item:**
```
{
  Market: "Renfrew",
  ts: 1546318800,
  Temp: -1.3,                              // Celsius
  Humid: 97,                               // Percentage
  Precip: 1.8,                             // mm precipitation
  Forecast: false                          // false = actual, true = forecast
}
```

**Key Observations:**
- ~495,707 records (years of weather data)
- Distinguishes actual vs forecast data
- Weather affects order volume and delivery times
- Input for demand prediction and driver scheduling

---

### 27. ValleyEats-RestaurantHealthCache

Pre-computed restaurant health scores and operational metrics.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `PK` | S (e.g., "HEALTH#ea1be5e0-...") |
| SK (RANGE) | `SK` | S (e.g., "YEAR#2026") |

**Sample Item:**
```
{
  PK: "HEALTH#ea1be5e0-7c43-4e73-ac47-d460231ea10f",
  SK: "YEAR#2026",

  restaurantId: "ea1be5e0-...",
  restaurantName: "Mo'Cha Bubble Tea",
  market: "PortElgin",
  teamManager: "Jessica Kenney",

  // Health metrics
  healthScore: 95,                         // 0-100
  alertLevel: "star",                      // star, warning, critical
  alertIcon: "(party emoji)",

  // Order metrics
  totalOrders: 26,
  completedOrders: 25,
  cancelledOrders: 1,
  ordersPerWeek: 2,
  avgOrderValue: 21.6,                     // Dollars
  totalRevenue: 540,                       // Dollars

  // Reliability metrics
  onTimeHandoffRate: 72.73,                // Percentage
  avgRestaurantDelay: 3.23,                // Minutes
  cancellationRate: 3.85,                  // Percentage
  delayCount: 6,

  // Problem tracking
  problemOrderCount: 0,
  problemOrderRate: 0,
  criticalProblemCount: 0,
  moderateProblemCount: 0,
  restaurantFaultCancellations: 0,

  // Rating
  avgRating: 5,
  highRatingCount: 1,
  lowRatingCount: 0,
  ratedOrdersCount: 1,

  // Pattern indicators
  patternIndicators: {
    consecutiveFailures: 0,
    unconfirmedOrderCount: 0,
    activeDaysInWindow: 22,
    recentUnconfirmedRate: 0,
    peakOrdersPerWeek: 5,
    avgMonthlyRevenue: 180
  },

  // Trends
  weeklyTrends: {
    weekLabels: ["Feb 18", "Feb 25", "Mar 4", "Mar 11", "Mar 18"],
    ordersPerWeek: [1, 0, 4, 0, 3],
    completedOrdersPerWeek: [1, 0, 4, 0, 3],
    revenuePerWeek: [29.55, 0, 91.64, 0, 74.06],
    cancellationRatePerWeek: [0, 0, 0, 0, 0]
  },

  // Cache management
  lastOrderDate: "2026-03-23T17:11:18.000Z",
  updatedAt: "2026-03-25T05:00:31.188Z",
  ExpiresAt: 1774504822
}
```

**Key Observations:**
- ~326 cached health reports
- Single-table design with PK/SK pattern
- Rich pre-computed metrics for instant dashboard rendering
- `alertLevel` values: "star" (excellent), "warning", "critical"
- Trend data for 5-week rolling windows
- Critical for Sisyphus restaurant reliability scoring

---

### 28. ValleyEats-RestaurantIntelligenceReports

AI-generated restaurant intelligence reports.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `PK` | S |
| SK (RANGE) | `SK` | S |

**Key Observations:**
- ~3,188 reports
- Single-table design (likely similar pattern to HealthCache)
- Created 2026-01-21 (very recent)

---

## Communication Tables

### 29. ValleyEats-MessageHistory

Push notification delivery history.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `MessageId` | S (SNS message ID) |

**GSIs:**

| GSI Name | Partition Key | Sort Key | Projection |
|----------|--------------|----------|------------|
| `History-index` | Recipient | Sent | ALL |

**Sample Item:**
```
{
  MessageId: "bdfa3c19-1e8a-5df6-98e6-5d5f8c449f33",
  Recipient: "customer@example.com",
  Sent: 1758236814,
  Received: true,
  Source: "processOrdersTable",            // Lambda function that sent it
  TargetArn: "arn:aws:sns:...",
  Body: {
    title: "Order On Its Way",
    body: "Your order #ae3af3e4 from McDonald's is on its way...",
    NotificationType: "OrderInTransit",    // Values: "OrderInTransit", "Message"
    DisplayType: "Drawer",                 // UI display type
    OrderId: "ae3af3e4-...",
    DriverId: "driver@example.com"
  }
}
```

**Key Observations:**
- ~596,614 message records
- Tracks delivery status of push notifications
- `Source` identifies which Lambda function triggered the message
- `NotificationType` categorizes the notification type
- Valuable for understanding communication patterns

---

### 30. ValleyEats-Alerts

System-wide alert/ETA indicators per market.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `Title` | S |

**Sample Item:**
```
{
  Title: "PetawawaEta",                    // Format: "{Market}Eta"
  Eta: "5",                                // Minutes (string)
  System: true,                            // System-generated
  timestamp: 1774452008
}
```

**Key Observations:**
- ~18 alerts (one per market)
- Real-time ETA estimates per market
- `Eta` is in minutes (stored as string)
- Constantly updated by the system

---

## Financial Tables

### 31. ValleyEats-Transactions

Payment transactions (Stripe charges, refunds).

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `TransactionId` | S (Stripe charge ID) |
| SK (RANGE) | `Timestamp` | N (Unix epoch) |

**GSIs:**

| GSI Name | Partition Key | Sort Key | Projection |
|----------|--------------|----------|------------|
| `CustomerId-Timestamp-index` | CustomerId | Timestamp | ALL |
| `UserId-Timestamp-index` | UserId | Timestamp | ALL |
| `OrderId-Timestamp-index` | OrderId | Timestamp | ALL |
| `Type-Timestamp-index` | Type | Timestamp | ALL |

**Sample Item:**
```
{
  TransactionId: "ch_1GrVODBFhoH7qt3mkFm2JsEg",  // Stripe charge ID
  Timestamp: 1591562814,

  Type: "Order Payment",
  Amount: 4954,                            // Cents

  OrderId: "df68f738-...",
  UserId: "customer@example.com",
  CustomerId: "cus_EknIDehbsCtJql",        // Stripe customer
  RestaurantId: "fd91dd3e-...",

  Description: "Order from PetawawaSubway",
  PayMethod: "visa 2287",
  Tokenization: "apple_pay",              // Payment method (optional)
  StripeFee: 161,                          // Cents
  ReceiptURL: "https://pay.stripe.com/..."
}
```

**Key Observations:**
- ~1,343,056 transactions
- `Amount` and `StripeFee` in cents
- `Type` values: "Order Payment" (likely also refunds)
- `Tokenization` field tracks payment method (Apple Pay, Google Pay, etc.)

---

## Vendor Portal Tables

### 32. ValleyEats-VendorActivityLogs

Restaurant partner portal activity audit trail.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `Date` | S (ISO date) |
| SK (RANGE) | `LogId` | S (composite) |

**GSIs:**

| GSI Name | Partition Key | Sort Key | Projection |
|----------|--------------|----------|------------|
| `UserIndex` | UserId | Timestamp | ALL |
| `RestaurantIndex` | RestaurantId | Timestamp | ALL |

**Sample Item:**
```
{
  Date: "2026-01-21",
  LogId: "1769025954276_cad2533f-...",
  Timestamp: "2026-01-21T20:05:54.276Z",

  Action: "CREATE_SUPPORT_ISSUE",
  UserId: "c0b2c5b2-...",
  UserName: "Unknown",
  RestaurantId: "ab8a647e-...",

  Details: "{\"issueId\":\"b514d572\",\"issueType\":\"Tablet Not Holding Charge\",...}"
}
```

**Key Observations:**
- ~26,799 logs
- Tracks vendor portal actions (issue creation, menu edits, etc.)
- `Details` is a JSON string (not a map) -- needs parsing

---

### 33. ValleyEats-MenuItems

Individual menu items per restaurant.

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `RestaurantId` | S (UUID) |
| SK (RANGE) | `ItemId` | S (UUID) |

**Key Observations:**
- ~66,688 menu items
- Keyed by restaurant + item (efficient for per-restaurant menu loading)
- Item structure same as `OrderItems` embedded in Orders table

---

### 34. ValleyEats-Menus

Menu containers (newer table, likely for multi-menu support).

**Schema:**
| Key | Attribute | Type |
|-----|-----------|------|
| PK (HASH) | `RestaurantId` | S (UUID) |
| SK (RANGE) | `MenuId` | S (UUID) |

**GSIs:**

| GSI Name | Partition Key | Sort Key | Projection |
|----------|--------------|----------|------------|
| `DeliverectMenuIndex` | DeliverectMenuId | RestaurantId | ALL |

**Key Observations:**
- Only 2 records (very new, 2025-12)
- Supports Deliverect POS integration
- Will likely grow as POS integrations expand

---

## Additional Tables (Catalogued)

These tables exist but are less critical for the AI dispatcher. Brief notes:

| Table | PK | Items | Purpose |
|-------|-----|-------|---------|
| `ValleyEats-AbandonedCarts` | ? | ? | Abandoned order tracking |
| `ValleyEats-AccountAdjustments` | ? | ? | Manual account adjustments |
| `ValleyEats-Analytics` | ? | ? | Analytics data |
| `ValleyEats-Applicants` | ? | ? | Driver applications |
| `ValleyEats-AppSettings` | ? | ? | Application config |
| `ValleyEats-AsyncJobs` | ? | ? | Background job queue |
| `ValleyEats-AuditLog` | ? | ? | General audit trail |
| `ValleyEats-Badges` | ? | ? | Driver achievement badges |
| `ValleyEats-BlogPosts` | ? | ? | Marketing content |
| `ValleyEats-Bulletins` | ? | ? | Internal bulletins |
| `ValleyEats-ConnectContacts` | ? | ? | Business contacts |
| `ValleyEats-DailyReportSnapshots` | ? | ? | Daily operational reports |
| `ValleyEats-Discounts` | ? | ? | Active discount rules |
| `ValleyEats-DriverBackground` | ? | ? | Driver background checks |
| `ValleyEats-DriverPointsLedger` | ? | ? | Points transaction log |
| `ValleyEats-DriverShopItems` | ? | ? | Driver reward shop items |
| `ValleyEats-DriverShopRequest` | ? | ? | Driver shop orders |
| `ValleyEats-DynamicHours` | ? | ? | Dynamic restaurant hours |
| `ValleyEats-EmailCampaigns` | ? | ? | Email marketing |
| `ValleyEats-EmployeeClock` | ? | ? | Employee time tracking |
| `ValleyEats-EmployeeShifts` | ? | ? | Employee shift scheduling |
| `ValleyEats-Franchises` | PK: FranchiseId | 44 | Franchise groupings |
| `ValleyEats-GiftCards` | ? | ? | Gift card management |
| `ValleyEats-GroupOrders` | ? | ? | Group order support |
| `ValleyEats-MarketNotices` | ? | ? | Market-level notices |
| `ValleyEats-MarketPromotions` | ? | ? | Market promotions |
| `ValleyEats-ModifierGroups` | ? | ? | Menu modifier groups |
| `ValleyEats-Notices` | ? | ? | System notices |
| `ValleyEats-OpenShiftsDraft` | ? | ? | Draft open shifts |
| `ValleyEats-PaymentSessions` | ? | ? | Payment session tracking |
| `ValleyEats-PromoCodes` | ? | ? | Promo codes |
| `ValleyEats-RFMHistory` | ? | ? | Recency/Frequency/Monetary |
| `ValleyEats-RestaurantBackground` | ? | ? | Restaurant onboarding |
| `ValleyEats-RosterCalculationCache` | ? | ? | Roster optimization cache |
| `ValleyEats-Subscriptions` | ? | ? | Customer subscriptions |
| `ValleyEats-SystemHealthLogs` | PK: pk, SK: timestamp | 65,795 | System health monitoring |
| `ValleyEats-TestOrders/Sessions` | ? | ? | QA testing |
| `ValleyEats-UserBackground` | ? | ? | User verification |
| `ValleyEats-UserBadges` | ? | ? | Customer achievements |

**Accountant System Tables (`ve-prd-accountant-*`):**
- `ve-prd-accountant-action-batches`
- `ve-prd-accountant-config`
- `ve-prd-accountant-jobs`
- `ve-prd-accountant-pending-actions`
- `ve-prd-accountant-training-*` (changes, config, patterns, sessions)
- `ve-prd-accountant-transactions`

These support an AI accounting system that is separate from dispatch.

---

## Key Relationships & Foreign Keys

```
Users.Email ----< Orders.UserId
Drivers.DriverId ----< Orders.DriverId
Restaurants.RestaurantId ----< Orders.RestaurantId

Orders.OrderId ----< IssueTracker.OrderId
Orders.OrderIdKey ----< IssueTracker.OrderIdKey
Orders.OrderId ----< Disputes.OrderId
Orders.OrderId ----< OrderErrors.OrderId
Orders.OrderId ----< DriverLocationHistory.OrderId
Orders.OrderId ----< Transactions.OrderId

Drivers.DriverId ----< DriverShifts.DriverId
Drivers.DriverId ----< DriverAvailability.DriverId
Drivers.DriverId ----< DriverMessages.DriverId
Drivers.DriverId ----< DriverLatestMessage.DriverId
Drivers.DriverId ----< DriverPoints.DriverId
Drivers.DriverId ----< DriverBans.DriverId
Drivers.DriverId ----< DriverLocationHistory.DriverId

Restaurants.RestaurantId ----< MenuItems.RestaurantId
Restaurants.RestaurantId ----< Menus.RestaurantId
Restaurants.RestaurantId ----< RestaurantHealthCache.restaurantId (in PK)
Restaurants.RestaurantId ----< VendorActivityLogs.RestaurantId

Users.CustomerId ----< Transactions.CustomerId

IssueTracker.IssueId ----< DispatchAiToolFeedback.IssueId
```

### Identity Model

| Entity | Primary Identifier | Format | Example |
|--------|-------------------|--------|---------|
| Order | OrderId | UUID | `5727b0c4-9ef0-4cc0-899d-71ea853aa879` |
| Order (short) | OrderIdKey | First 8 chars of UUID | `5727b0c4` |
| Driver | DriverId | Email address | `driver@example.com` |
| Restaurant | RestaurantId | UUID | `a166e272-c622-4879-9036-9a629abd17df` |
| Restaurant (short) | RestaurantIdKey | First 8 chars of UUID | `a166e272` |
| User/Customer | Email | Email address | `user@example.com` |
| User (Stripe) | CustomerId | Stripe customer ID | `cus_SctjAaJs0q8lPB` |
| Employee | Email + Title | Composite | `nick@valleyeats.ca` + `Software Developer` |
| Issue | IssueId | Short hash (8 chars) | `b04b887b` |
| Market/Zone | Name | String | `Pembroke`, `Perth`, `PortElgin` |

---

## Ontology Design Implications

### Critical Entities for Sisyphus

1. **Order** -- The central object. Rich lifecycle with 12+ timestamp stages.
2. **Driver** -- Small fleet (~748) with real-time status, location, and zone.
3. **Restaurant** -- Health scores, hours, reliability metrics available.
4. **Market** -- ~22 markets with real-time demand meters and weather.
5. **Issue** -- Support tickets with full conversation threads.
6. **Shift** -- Both scheduled and open shifts, with availability data.

### Key Patterns to Support

| Pattern | Tables Involved | Query Pattern |
|---------|----------------|---------------|
| "Active orders in zone X" | Orders (DeliveryZone-OrderReadyTime GSI) | Scan by zone + status |
| "Available drivers in zone X" | Drivers (DispatchZone GSI) + Available flag | Filter by zone + available |
| "Driver's current orders" | Orders (DriverId-OrderReadyTime GSI) | Query by driver + active status |
| "Restaurant health" | RestaurantHealthCache (PK pattern) | Direct lookup |
| "Market demand right now" | MarketMeters (PK) | Direct lookup |
| "Issues for this order" | IssueTracker (OrderIdKey-Created GSI) | Query by order |
| "Driver shift today" | DriverShifts (date-index GSI) | Query by date + market |
| "Message a driver" | DriverMessages (PK: DriverId) | Append to conversation |
| "AI decision history" | AIDecisions (PK: date, SK: timestamp) | Time-range query |

### Data Quirks Sisyphus Must Handle

1. **Mixed currency units**: Orders use cents (integers), Disputes use dollars (decimals)
2. **Mixed time units**: Timestamps in Unix seconds, hours in minutes-from-midnight, durations in seconds
3. **Email as PK**: Drivers and Users use email addresses as primary keys (not UUIDs)
4. **Denormalized data**: Restaurant name appears on Orders, Issues, etc.
5. **No explicit "dispatch queue"**: Active orders are queried via GSIs on the Orders table
6. **Shadow mode exists**: The AI system has a shadow/observe mode already
7. **Short IDs**: 8-char prefixes used for human-facing references (OrderIdKey, RestaurantIdKey)
8. **Embedded arrays**: Messages, actions, notes are embedded lists -- not separate tables
9. **DynamoDB Streams**: Enabled on most tables with NEW_AND_OLD_IMAGES -- can drive event pipelines
10. **TTL patterns**: Some tables use `ExpiresAt`/`ttl` for auto-cleanup (LocationHistory, AIMetrics)

### Market Names (All ~22)

Based on MarketMeters and other tables, the known market zones include:
- Arnprior, Casselman, Embrun, Pembroke, Perth, Petawawa, Picton, PortElgin, PortPerry, Renfrew, Stittsville
- (Additional markets exist in the full dataset)

### Action Vocabulary (from AIMetrics)

Actions the existing AI system tracks/recommends:
- `operations_call_couriers` -- Escalate to operations for phone outreach
- `reassign_if_available` -- Reassign order to different driver
- Issue types: `courier_not_accepting`, `pickup_delay`
- Severity levels: `critical`, `high`, `medium`
- Priority levels: `critical`, `urgent`

These should form the seed vocabulary for Sisyphus action types.
