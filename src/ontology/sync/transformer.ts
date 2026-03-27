/**
 * Transforms raw dispatch API responses into typed ontology objects.
 *
 * Each transformer maps DynamoDB field names (PascalCase / mixed-case) to
 * ontology property names (camelCase). Computed properties are derived here.
 *
 * Defensive coding throughout — optional chaining, defaults for missing fields.
 * We intentionally do NOT use Zod.parse here because live API data may contain
 * extra or missing fields; strict validation would crash the sync loop.
 */

import type {
  Order,
  OrderItem,
  Driver,
  Restaurant,
  Customer,
  Ticket,
  TicketAction,
  TicketMessage,
  TicketNote,
  Market,
  Conversation,
  Message,
  KitchenHours,
  DayHours,
} from "../objects/index.js";

import type { MoneyInCents, MinutesFromMidnight } from "../objects/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safe epoch-seconds → Date conversion. Returns null for falsy/non-number. */
function epochToDate(val: unknown): Date | null {
  if (val == null || typeof val !== "number" || val <= 0) return null;
  return new Date(val * 1000);
}

/** Safe coerce to number, returning 0 on failure. */
function num(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

/** Safe coerce to int, returning 0 on failure. */
function int(val: unknown, fallback = 0): number {
  return Math.round(num(val, fallback));
}

/** Safe coerce to boolean. */
function bool(val: unknown, fallback = false): boolean {
  if (typeof val === "boolean") return val;
  if (val === "true" || val === 1) return true;
  if (val === "false" || val === 0) return false;
  return fallback;
}

/** Safe coerce to string, returning fallback on falsy. */
function str(val: unknown, fallback = ""): string {
  if (typeof val === "string") return val;
  if (val == null) return fallback;
  return String(val);
}

/** Branded helper for MoneyInCents (type assertion — no runtime cost). */
function cents(val: unknown): MoneyInCents {
  return int(val) as unknown as MoneyInCents;
}

/** Branded helper for MinutesFromMidnight (type assertion). */
function minutesFromMidnight(val: unknown): MinutesFromMidnight {
  return int(val) as unknown as MinutesFromMidnight;
}

/**
 * Current time as Unix epoch seconds.
 * Extracted to a function so tests can mock it if needed.
 */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// ---------------------------------------------------------------------------
// Order transformer
// ---------------------------------------------------------------------------

function transformOrderItem(raw: any): OrderItem {
  return {
    itemId: str(raw?.ItemId),
    itemName: str(raw?.ItemName, "Unknown Item"),
    price: cents(raw?.Price),
    quantity: int(raw?.Quantity, 1),
    cuisine: raw?.Cuisine ?? undefined,
    menuOptions: raw?.MenuOptions ?? undefined,
    alcohol: raw?.Alcohol != null ? bool(raw.Alcohol) : undefined,
    taxable: raw?.Taxable != null ? bool(raw.Taxable) : undefined,
  };
}

export function transformOrder(raw: any): Order {
  const now = nowSeconds();
  const placedEpoch = num(raw?.OrderPlacedTime ?? raw?.OrderCreatedTime);
  const readyEpoch = raw?.OrderReadyTime ? num(raw.OrderReadyTime) : null;

  const waitTimeMinutes = placedEpoch > 0 ? Math.round((now - placedEpoch) / 60) : 0;
  const timeSinceReady = readyEpoch != null && readyEpoch > 0
    ? Math.round((now - readyEpoch) / 60)
    : null;

  // isLate heuristic: if food is ready and sitting for >15 minutes, or
  // if order is placed >45 minutes ago and not yet delivered
  const status = str(raw?.OrderStatus, "Pending");
  const isDelivered = status === "Completed" || status === "Cancelled";
  const isLate = !isDelivered && (
    (timeSinceReady != null && timeSinceReady > 15) ||
    (waitTimeMinutes > 45)
  );

  const rawItems = Array.isArray(raw?.OrderItems) ? raw.OrderItems : [];

  return {
    orderId: str(raw?.OrderId),
    orderIdKey: str(raw?.OrderIdKey ?? str(raw?.OrderId).slice(0, 8)),
    status: status as Order["status"],
    orderType: str(raw?.OrderType, "Delivery") as Order["orderType"],
    deliveryType: (raw?.DeliveryType ?? undefined) as Order["deliveryType"],
    isAsap: bool(raw?.ASAP, true),

    customerId: str(raw?.UserId),
    driverId: raw?.DriverId ? str(raw.DriverId) : null,
    restaurantId: str(raw?.RestaurantId),
    restaurantName: str(raw?.RestaurantName, "Unknown Restaurant"),

    deliveryZone: str(raw?.DeliveryZone),
    deliveryStreet: raw?.DeliveryStreet ?? undefined,
    deliveryCity: raw?.DeliveryCity ?? undefined,
    deliveryProvince: raw?.DeliveryProvince ?? undefined,
    deliveryInstructions: raw?.DeliveryInstructions ?? null,
    deliveryDistance: raw?.DeliveryDistance != null ? int(raw.DeliveryDistance) : undefined,

    customerLocation: raw?.CustomerLocation?.latitude != null
      ? { latitude: num(raw.CustomerLocation.latitude), longitude: num(raw.CustomerLocation.longitude) }
      : null,
    orderLocation: raw?.OrderLocation?.latitude != null
      ? { latitude: num(raw.OrderLocation.latitude), longitude: num(raw.OrderLocation.longitude) }
      : null,

    subtotal: cents(raw?.OrderSubtotal),
    tax: cents(raw?.Tax),
    deliveryFee: cents(raw?.DeliveryFee),
    tip: cents(raw?.Tip),
    total: cents(raw?.OrderTotal),

    hasAlcohol: bool(raw?.Alcohol),
    items: rawItems.map(transformOrderItem),

    // Lifecycle timestamps
    createdAt: epochToDate(raw?.OrderCreatedTime) ?? new Date(),
    placedAt: epochToDate(raw?.OrderPlacedTime) ?? epochToDate(raw?.OrderCreatedTime) ?? new Date(),
    confirmedAt: epochToDate(raw?.DeliveryConfirmedTime),
    driverAssignedAt: epochToDate(raw?.DriverAssignedTime),
    readyAt: epochToDate(raw?.OrderReadyTime),
    inBagAt: epochToDate(raw?.OrderInBagTime),
    enrouteAt: epochToDate(raw?.EnrouteTime),
    inTransitAt: epochToDate(raw?.OrderInTransitTime),
    atCustomerAt: epochToDate(raw?.AtCustomerTime),
    deliveredAt: epochToDate(raw?.OrderDeliveredTime),

    // Timing metrics
    travelTime: raw?.TravelTime != null ? num(raw.TravelTime) : undefined,
    enrouteDuration: raw?.EnrouteDuration != null ? num(raw.EnrouteDuration) : undefined,

    // Computed
    isLate,
    waitTimeMinutes,
    timeSinceReady,
  };
}

// ---------------------------------------------------------------------------
// Driver transformer
// ---------------------------------------------------------------------------

export function transformDriver(raw: any): Driver {
  const isAvailable = bool(raw?.Available);
  const isPaused = bool(raw?.Paused);
  const isActive = bool(raw?.Active, true);
  const onShift = bool(raw?.OnShift);
  const connectionId: string | null = raw?.ConnectionId ? str(raw.ConnectionId) : null;

  // A driver is "online" if they're on-shift OR available (on-call), AND not paused.
  // dispatch.txt uses OnShift=true for drivers currently working a shift.
  // Available=true means the driver toggled on-call in the app.
  // Either makes them available for dispatch.
  const isOnline = (onShift || isAvailable) && !isPaused;

  // Derive logical status from raw flags
  let status: Driver["status"];
  if (!isActive) {
    status = "Inactive";
  } else if (isPaused) {
    status = "OnBreak";
  } else if (onShift || isAvailable) {
    status = "Online";
  } else {
    status = "Offline";
  }

  // Parse app settings if present
  const rawSettings = raw?.AppSetting;
  const appSettings = rawSettings
    ? {
        camera: rawSettings.Camera ?? undefined,
        geoLocate: rawSettings.GeoLocate ?? undefined,
        microphone: rawSettings.Microphone ?? undefined,
        phone: rawSettings.Phone ?? undefined,
        speech: rawSettings.Speech ?? undefined,
      }
    : undefined;

  return {
    driverId: str(raw?.DriverId),
    name: str(raw?.FullName, "Unknown Driver"),
    phone: str(raw?.Phone),
    monacher: raw?.Monacher ? str(raw.Monacher) : undefined,
    agentId: raw?.AgentId ?? undefined,

    dispatchZone: str(raw?.DispatchZone),
    deliveryArea: str(raw?.DeliveryArea),
    ignoreArea: bool(raw?.ignoreArea),

    isAvailable,
    isPaused,
    isActive,

    connectionId,
    appVersion: raw?.AppVersion ?? undefined,
    phoneModel: raw?.phoneModel ?? undefined,
    appSettings,

    trainingOrders: raw?.TrainingOrders != null ? int(raw.TrainingOrders) : undefined,

    currentLocation: raw?.DriverLocation?.latitude != null
      ? { latitude: num(raw.DriverLocation.latitude), longitude: num(raw.DriverLocation.longitude) }
      : null,

    scheduleString: raw?.ScheduleString ? str(raw.ScheduleString) : undefined,

    // Computed
    status,
    isOnline,
    // activeOrdersCount starts at 0; will be enriched by syncer if order data is available
    activeOrdersCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Restaurant transformer
// ---------------------------------------------------------------------------

function transformDayHours(raw: any): DayHours | undefined {
  if (raw == null) return undefined;
  const open = raw.open ?? raw.Open;
  const closed = raw.closed ?? raw.Closed;
  if (open == null || closed == null) return undefined;
  return {
    open: minutesFromMidnight(open),
    closed: minutesFromMidnight(closed),
  };
}

function transformKitchenHours(raw: any): KitchenHours | undefined {
  if (raw == null) return undefined;
  return {
    Mon: transformDayHours(raw.Mon),
    Tue: transformDayHours(raw.Tue),
    Wed: transformDayHours(raw.Wed),
    Thu: transformDayHours(raw.Thu),
    Fri: transformDayHours(raw.Fri),
    Sat: transformDayHours(raw.Sat),
    Sun: transformDayHours(raw.Sun),
  };
}

/**
 * Determine whether a restaurant is currently open based on its KitchenHours
 * and the current local time.
 */
function computeIsOpen(kitchenHours: KitchenHours | undefined): boolean {
  if (!kitchenHours) return false;

  const now = new Date();
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
  const dayKey = dayNames[now.getDay()];
  const dayHours = kitchenHours[dayKey];

  if (!dayHours) return false;

  // Minutes from midnight in local time
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const openMin = Number(dayHours.open);
  const closeMin = Number(dayHours.closed);

  // Handle overnight hours (e.g., open=1080 close=180 means 6PM-3AM)
  if (closeMin < openMin) {
    return currentMinutes >= openMin || currentMinutes < closeMin;
  }

  return currentMinutes >= openMin && currentMinutes < closeMin;
}

export function transformRestaurant(raw: any): Restaurant {
  const now = nowSeconds();
  const lastHeartbeat = raw?.LastHeartbeat ? num(raw.LastHeartbeat) : undefined;
  const isTabletOnline = lastHeartbeat != null && (now - lastHeartbeat) < 300; // 5 minutes

  const kitchenHours = transformKitchenHours(raw?.KitchenHours);
  const isOpen = computeIsOpen(kitchenHours);

  return {
    restaurantId: str(raw?.RestaurantId),
    restaurantIdKey: str(raw?.RestaurantIdKey ?? str(raw?.RestaurantId).slice(0, 8)),
    name: str(raw?.RestaurantName, "Unknown Restaurant"),

    phone: str(raw?.Phone),
    email: raw?.Email ?? undefined,

    city: str(raw?.City),
    province: str(raw?.Province),
    deliveryZone: str(raw?.DeliveryZone),

    cuisine: raw?.PrimaryCuisine ?? undefined,
    priceLevel: raw?.Price != null ? int(raw.Price) as Restaurant["priceLevel"] : undefined,

    isActive: bool(raw?.Restaurant, true),
    deliveryAvailable: bool(raw?.DeliveryAvailable),

    commission: raw?.Commission != null ? num(raw.Commission) : undefined,
    posEta: raw?.POSETA != null ? int(raw.POSETA) : undefined,

    kitchenHours,
    defaultHours: transformKitchenHours(raw?.DefaultHours),

    lastHeartbeat: lastHeartbeat ?? undefined,
    menuSections: Array.isArray(raw?.MenuSections) ? raw.MenuSections : undefined,

    // Computed
    isOpen,
    isTabletOnline,
    healthScore: raw?.healthScore != null ? num(raw.healthScore) : null,
    alertLevel: raw?.alertLevel ?? null,
    // currentLoad starts at 0; enriched by syncer if order data is available
    currentLoad: 0,
  };
}

// ---------------------------------------------------------------------------
// Customer transformer
// ---------------------------------------------------------------------------

export function transformCustomer(raw: any): Customer {
  const rawAddresses = Array.isArray(raw?.DeliveryAddresses) ? raw.DeliveryAddresses : [];
  const rawMessages = Array.isArray(raw?.Messages) ? raw.Messages : undefined;

  return {
    email: str(raw?.Email),
    name: str(raw?.FullName, "Unknown Customer"),
    phone: str(raw?.Phone),
    stripeCustomerId: raw?.CustomerId ?? undefined,

    createdAt: epochToDate(raw?.Created) ?? undefined,

    deliveryAddresses: rawAddresses.map((addr: any) => ({
      deliveryStreet: str(addr?.DeliveryStreet),
      deliveryCity: str(addr?.DeliveryCity),
      deliveryProvince: str(addr?.DeliveryProvince),
      deliveryCountry: addr?.DeliveryCountry ?? undefined,
      deliveryPostal: addr?.DeliveryPostal ?? undefined,
      deliveryLat: addr?.DeliveryLat != null ? num(addr.DeliveryLat) : undefined,
      deliveryLng: addr?.DeliveryLng != null ? num(addr.DeliveryLng) : undefined,
      deliveryAptNo: addr?.DeliveryAptNo ?? null,
      deliveryInstructions: addr?.DeliveryInstructions ?? null,
      deliveryType: addr?.DeliveryType ?? undefined,
    })),

    perksPoints: int(raw?.PerksPoints),

    messages: rawMessages?.map((msg: any) => ({
      message: str(msg?.message),
      sent: epochToDate(msg?.sent) ?? new Date(),
      isRead: bool(msg?.isread),
      issueId: msg?.IssueId ?? null,
    })),

    appVersion: raw?.AppVersion ?? undefined,

    // Computed — will be enriched by syncer if order data is available
    totalOrders: undefined,
  };
}

// ---------------------------------------------------------------------------
// Ticket transformer
// ---------------------------------------------------------------------------

function transformTicketAction(raw: any): TicketAction {
  return {
    timestamp: epochToDate(raw?.Timestamp) ?? new Date(),
    actor: str(raw?.Actor, "System"),
    description: str(raw?.Description),
  };
}

function transformTicketMessage(raw: any): TicketMessage {
  return {
    message: str(raw?.Message),
    originator: str(raw?.Originator),
    sent: epochToDate(raw?.Send ?? raw?.Sent) ?? new Date(),
    read: epochToDate(raw?.Read),
  };
}

function transformTicketNote(raw: any): TicketNote {
  return {
    author: str(raw?.Author, "System"),
    timestamp: epochToDate(raw?.Timestamp) ?? new Date(),
    note: str(raw?.Note),
  };
}

export function transformTicket(raw: any): Ticket {
  const rawActions = Array.isArray(raw?.Actions) ? raw.Actions : undefined;
  const rawMessages = Array.isArray(raw?.Messages) ? raw.Messages : undefined;
  const rawNotes = Array.isArray(raw?.Notes) ? raw.Notes : undefined;

  return {
    issueId: str(raw?.IssueId),
    category: str(raw?.Category, "Order Issue") as Ticket["category"],
    issueType: str(raw?.IssueType, "Other"),
    status: str(raw?.IssueStatus, "New") as Ticket["status"],

    createdAt: epochToDate(raw?.Created) ?? new Date(),

    orderId: raw?.OrderId ?? null,
    orderIdKey: raw?.OrderIdKey ?? null,
    restaurantId: raw?.RestaurantId ?? null,
    restaurantName: raw?.RestaurantName ?? null,
    driverId: raw?.DriverId ?? null,
    market: raw?.Market ?? undefined,

    originator: str(raw?.Originator, "Unknown"),
    owner: str(raw?.Owner, "Unassigned"),

    description: str(raw?.Description),
    resolution: raw?.Resolution ?? null,

    actions: rawActions?.map(transformTicketAction),
    messages: rawMessages?.map(transformTicketMessage),
    notes: rawNotes?.map(transformTicketNote),
  };
}

// ---------------------------------------------------------------------------
// Market transformer
// ---------------------------------------------------------------------------

/**
 * Derive demand level from the market score (0-100).
 *   0–25  → Low
 *  26–50  → Normal
 *  51–75  → High
 *  76–100 → Surge
 */
function computeDemandLevel(score: number): Market["demandLevel"] {
  if (score <= 25) return "Low";
  if (score <= 50) return "Normal";
  if (score <= 75) return "High";
  return "Surge";
}

export function transformMarket(raw: any): Market {
  const score = num(raw?.Score ?? raw?.score);
  const idealDrivers = int(raw?.idealDrivers ?? raw?.IdealDrivers);
  const availableDrivers = int(raw?.drivers ?? raw?.Drivers ?? raw?.availableDrivers);

  const activeOrders = int(raw?.activeOrders ?? raw?.ActiveOrders);
  const driverToOrderRatio = activeOrders > 0 ? availableDrivers / activeOrders : null;

  return {
    market: str(raw?.Market ?? raw?.market),

    score,
    idealDrivers,
    availableDrivers,
    lastUpdated: epochToDate(raw?.ts ?? raw?.Ts ?? raw?.lastUpdated) ?? new Date(),

    eta: raw?.Eta != null ? num(raw.Eta) : (raw?.eta != null ? num(raw.eta) : null),

    demandPredictions: Array.isArray(raw?.Predictions)
      ? raw.Predictions.map((p: any) => ({
          date: str(p?.date),
          dayOfWeek: str(p?.day_of_week),
          time: str(p?.time),
          driversPredicted: int(p?.drivers_predicted),
          driversMin: int(p?.drivers_min),
          driversMax: int(p?.drivers_max),
        }))
      : undefined,

    demandPredictionMeta: raw?.Metadata
      ? {
          modelConfidence: raw.Metadata.model_confidence ?? undefined,
          predictionPeriod: raw.Metadata.prediction_period ?? undefined,
          trainingDataPoints: raw.Metadata.training_data_points != null
            ? int(raw.Metadata.training_data_points)
            : undefined,
          generatedAt: raw.Metadata.generated_at ?? undefined,
        }
      : undefined,

    // Computed
    driverGap: idealDrivers - availableDrivers,
    demandLevel: computeDemandLevel(score),
    activeOrders,
    driverToOrderRatio,
  };
}

// ---------------------------------------------------------------------------
// Conversation transformer
// ---------------------------------------------------------------------------

export function transformConversation(raw: any): Conversation {
  const lastColour = str(raw?.Colour ?? raw?.LastColour, "");
  const lastMessageFromDriver = lastColour === "Undefined";

  const lastMessageAt = epochToDate(raw?.ts ?? raw?.Ts) ?? new Date();
  const lastOpenedAt = epochToDate(raw?.Opened);

  // hasUnread: driver sent something after the conversation was last opened
  const hasUnread = lastMessageFromDriver && (
    lastOpenedAt == null || lastMessageAt > lastOpenedAt
  );

  return {
    driverId: str(raw?.DriverId),
    lastMessageAt,
    lastMessagePreview: str(raw?.Message, ""),
    lastAuthor: str(raw?.Author, "Unknown"),
    lastColour,
    lastOpenedAt,

    // Computed
    lastMessageFromDriver,
    hasUnread,
  };
}

// ---------------------------------------------------------------------------
// Message transformer
// ---------------------------------------------------------------------------

export function transformMessage(raw: any): Message {
  const colour = str(raw?.Colour, "");
  return {
    driverId: str(raw?.DriverId),
    timestamp: epochToDate(raw?.ts ?? raw?.Ts) ?? new Date(),
    content: str(raw?.Message, ""),
    author: str(raw?.Author, "Unknown"),
    colour,
    isFromDriver: colour === "Undefined",
  };
}
