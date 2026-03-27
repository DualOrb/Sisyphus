/**
 * Builds a force-graph data structure from all ontology entities.
 *
 * Node types: market, restaurant, order, driver, ticket
 * Link types: restaurant-market, order-restaurant, order-driver, driver-market, ticket-order
 */

// ---------------------------------------------------------------------------
// Deterministic hash — maps any string to [0, 1]
// ---------------------------------------------------------------------------

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0) / 4294967295;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntityType = "market" | "restaurant" | "order" | "driver" | "ticket";

export interface GraphNode {
  id: string;
  entityType: EntityType;
  label: string;
  sublabel?: string;
  status?: string;
  zone?: string;
  isLate?: boolean;
  val: number; // node size
  color: string;
  raw: any; // original entity data
  x: number;
  y: number;
  z: number;
}

export interface GraphLink {
  source: string;
  target: string;
  type: string;
  color: string;
  width: number;
  dashed?: boolean;
  particles?: number;
  sourcePos: [number, number, number];
  targetPos: [number, number, number];
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// ---------------------------------------------------------------------------
// Color maps
// ---------------------------------------------------------------------------

const ORDER_COLORS: Record<string, string> = {
  Pending: "#eab308",
  Confirmed: "#3b82f6",
  Ready: "#06b6d4",
  EnRoute: "#6366f1",
  InTransit: "#a855f7",
  Completed: "#10b981",
  Cancelled: "#6b7280",
};

const DRIVER_COLORS: Record<string, string> = {
  Online: "#10b981",
  Busy: "#3b82f6",
  Offline: "#4b5563",
  OnBreak: "#eab308",
  Inactive: "#374151",
};

const TICKET_COLORS: Record<string, string> = {
  New: "#f97316",
  Pending: "#eab308",
  Resolved: "#10b981",
  Closed: "#6b7280",
};

const MARKET_COLORS = [
  "#3b82f6", "#8b5cf6", "#06b6d4", "#f59e0b",
  "#ef4444", "#10b981", "#ec4899", "#6366f1",
];

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildGraphData(
  orders: any[],
  drivers: any[],
  restaurants: any[],
  markets: any[],
  tickets: any[],
): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const nodeIds = new Set<string>(); // track what exists so we don't create dead links

  // Lookup maps for positioning children relative to parents
  const marketPos = new Map<string, { x: number; y: number; z: number }>();
  const driverPos = new Map<string, { x: number; y: number; z: number }>();
  const orderPos = new Map<string, { x: number; y: number; z: number }>();
  const nodeMap = new Map<string, GraphNode>();

  // -- Markets (ring on XZ plane, radius 800) --
  const marketCount = Math.max(markets.length, 1);
  const RING_RADIUS = 3000;

  markets.forEach((m, i) => {
    const color = MARKET_COLORS[i % MARKET_COLORS.length];
    const angle = (2 * Math.PI * i) / marketCount;
    const id = `market:${m.market}`;
    const x = RING_RADIUS * Math.cos(angle);
    const y = i % 2 === 0 ? -20 : 20;
    const z = RING_RADIUS * Math.sin(angle);
    nodeIds.add(id);
    marketPos.set(m.market, { x, y, z });
    const node: GraphNode = {
      id,
      entityType: "market",
      label: m.market,
      sublabel: `Score: ${m.score ?? "?"}  |  ${m.availableDrivers ?? 0}/${m.idealDrivers ?? 0} drivers`,
      status: m.demandLevel,
      zone: m.market,
      val: 40,
      color,
      raw: m,
      x, y, z,
    };
    nodes.push(node);
    nodeMap.set(id, node);
  });

  // -- Restaurants (disc around market, radius 40-70) --
  restaurants.forEach((r) => {
    const zone = r.deliveryZone;
    const id = `restaurant:${r.restaurantId}`;
    const mp = zone ? marketPos.get(zone) : undefined;
    const angle = hashStr(r.restaurantId) * 2 * Math.PI;
    const radius = 180 + hashStr(r.restaurantId + "r") * 140; // 180-320
    const x = (mp?.x ?? 0) + radius * Math.cos(angle);
    const y = (mp?.y ?? 0) + (hashStr(r.restaurantId + "y") * 30 - 15);
    const z = (mp?.z ?? 0) + radius * Math.sin(angle);
    nodeIds.add(id);
    const node: GraphNode = {
      id,
      entityType: "restaurant",
      label: r.name,
      sublabel: r.isOpen ? "Open" : "Closed",
      status: r.isOpen ? "Open" : "Closed",
      zone,
      val: 8,
      color: r.isOpen ? "#10b981" : "#4b5563",
      raw: r,
      x, y, z,
    };
    nodes.push(node);
    nodeMap.set(id, node);

    if (zone && nodeIds.has(`market:${zone}`)) {
      links.push({
        source: id,
        target: `market:${zone}`,
        type: "restaurant-market",
        color: "#334455",
        width: 0.3,
        sourcePos: [0, 0, 0],
        targetPos: [0, 0, 0],
      });
    }
  });

  // -- Drivers (disc around market, radius 50-90) --
  drivers.forEach((d) => {
    const zone = d.dispatchZone;
    const id = `driver:${d.driverId}`;
    const mp = zone ? marketPos.get(zone) : undefined;
    const angle = hashStr(d.driverId) * 2 * Math.PI;
    const radius = 220 + hashStr(d.driverId + "r") * 180; // 220-400
    const x = (mp?.x ?? 0) + radius * Math.cos(angle);
    const y = (mp?.y ?? 0) + (hashStr(d.driverId + "y") * 30 - 15);
    const z = (mp?.z ?? 0) + radius * Math.sin(angle);
    nodeIds.add(id);
    driverPos.set(d.driverId, { x, y, z });
    const node: GraphNode = {
      id,
      entityType: "driver",
      label: d.name ?? d.monacher ?? d.driverId.split("@")[0],
      sublabel: `${d.status} | ${d.activeOrdersCount ?? 0} orders`,
      status: d.status,
      zone,
      val: 6,
      color: DRIVER_COLORS[d.status] ?? "#4b5563",
      raw: d,
      x, y, z,
    };
    nodes.push(node);
    nodeMap.set(id, node);

    if (zone && nodeIds.has(`market:${zone}`)) {
      links.push({
        source: id,
        target: `market:${zone}`,
        type: "driver-market",
        color: "#2a3a4a",
        width: 0.2,
        sourcePos: [0, 0, 0],
        targetPos: [0, 0, 0],
      });
    }
  });

  // -- Orders --
  orders.forEach((o) => {
    const isLate = !!o.isLate;
    const baseColor = ORDER_COLORS[o.status] ?? "#6b7280";
    const id = `order:${o.orderId}`;

    // Determine position
    let x = 0, y = 0, z = 0;
    const dp = o.driverId ? driverPos.get(o.driverId) : undefined;
    if (dp) {
      // Offset 15-25 from driver
      const angle = hashStr(o.orderId) * 2 * Math.PI;
      const radius = 70 + hashStr(o.orderId + "r") * 60;
      x = dp.x + radius * Math.cos(angle);
      y = dp.y + (hashStr(o.orderId + "y") * 10 - 5);
      z = dp.z + radius * Math.sin(angle);
    } else if (o.deliveryZone && marketPos.has(o.deliveryZone)) {
      // Disc around market, radius 70-110
      const mp = marketPos.get(o.deliveryZone)!;
      const angle = hashStr(o.orderId) * 2 * Math.PI;
      const radius = 300 + hashStr(o.orderId + "r") * 200;
      x = mp.x + radius * Math.cos(angle);
      y = mp.y + (hashStr(o.orderId + "y") * 20 - 10);
      z = mp.z + radius * Math.sin(angle);
    }
    // else fallback: near origin (x=0, y=0, z=0)

    nodeIds.add(id);
    orderPos.set(o.orderId, { x, y, z });
    const node: GraphNode = {
      id,
      entityType: "order",
      label: o.orderIdKey ?? o.orderId?.slice(0, 8),
      sublabel: `${o.status}${isLate ? " LATE" : ""} | ${o.restaurantName ?? ""}`,
      status: o.status,
      zone: o.deliveryZone,
      isLate,
      val: isLate ? 5 : 3,
      color: isLate ? "#ef4444" : baseColor,
      raw: o,
      x, y, z,
    };
    nodes.push(node);
    nodeMap.set(id, node);

    let linkedToSomething = false;

    // Link to restaurant (only if node exists)
    if (o.restaurantId && nodeIds.has(`restaurant:${o.restaurantId}`)) {
      links.push({
        source: id,
        target: `restaurant:${o.restaurantId}`,
        type: "order-restaurant",
        color: "#445566",
        width: 0.4,
        sourcePos: [0, 0, 0],
        targetPos: [0, 0, 0],
      });
      linkedToSomething = true;
    }

    // Link to driver (assigned)
    if (o.driverId && nodeIds.has(`driver:${o.driverId}`)) {
      links.push({
        source: id,
        target: `driver:${o.driverId}`,
        type: "order-driver",
        color: "#6366f1",
        width: 1.2,
        particles: o.status === "EnRoute" || o.status === "InTransit" ? 2 : 0,
        sourcePos: [0, 0, 0],
        targetPos: [0, 0, 0],
      });
      linkedToSomething = true;
    }

    // Fallback: link to market by zone so orders don't float loose
    if (!linkedToSomething && o.deliveryZone && nodeIds.has(`market:${o.deliveryZone}`)) {
      links.push({
        source: id,
        target: `market:${o.deliveryZone}`,
        type: "order-market",
        color: "#2a3a4a",
        width: 0.15,
        sourcePos: [0, 0, 0],
        targetPos: [0, 0, 0],
      });
    }
  });

  // -- Tickets --
  tickets.forEach((t) => {
    const id = `ticket:${t.issueId}`;

    // Determine position
    let x = 0, y = 0, z = 0;
    const op = t.orderId ? orderPos.get(t.orderId) : undefined;
    if (op) {
      // Offset 10-20 from order
      const angle = hashStr(t.issueId) * 2 * Math.PI;
      const radius = 60 + hashStr(t.issueId + "r") * 50;
      x = op.x + radius * Math.cos(angle);
      y = op.y + (hashStr(t.issueId + "y") * 10 - 5);
      z = op.z + radius * Math.sin(angle);
    } else if (t.market && marketPos.has(t.market)) {
      // Disc around market, radius 90-120
      const mp = marketPos.get(t.market)!;
      const angle = hashStr(t.issueId) * 2 * Math.PI;
      const radius = 350 + hashStr(t.issueId + "r") * 150;
      x = mp.x + radius * Math.cos(angle);
      y = mp.y + (hashStr(t.issueId + "y") * 20 - 10);
      z = mp.z + radius * Math.sin(angle);
    }
    // else fallback: near origin

    nodeIds.add(id);
    const node: GraphNode = {
      id,
      entityType: "ticket",
      label: t.issueId,
      sublabel: `${t.status} | ${t.issueType ?? t.category ?? ""}`,
      status: t.status,
      zone: t.market,
      val: 2,
      color: TICKET_COLORS[t.status] ?? "#6b7280",
      raw: t,
      x, y, z,
    };
    nodes.push(node);
    nodeMap.set(id, node);

    // Link to order (only if exists)
    if (t.orderId && nodeIds.has(`order:${t.orderId}`)) {
      links.push({
        source: id,
        target: `order:${t.orderId}`,
        type: "ticket-order",
        color: "#f97316",
        width: 0.5,
        dashed: true,
        sourcePos: [0, 0, 0],
        targetPos: [0, 0, 0],
      });
    } else if (t.market && nodeIds.has(`market:${t.market}`)) {
      // Fallback: link to market
      links.push({
        source: id,
        target: `market:${t.market}`,
        type: "ticket-market",
        color: "#f97316",
        width: 0.2,
        sourcePos: [0, 0, 0],
        targetPos: [0, 0, 0],
      });
    }
  });

  // -- Populate sourcePos / targetPos on all links --
  for (const link of links) {
    const src = nodeMap.get(link.source);
    const tgt = nodeMap.get(link.target);
    if (src) link.sourcePos = [src.x, src.y, src.z];
    if (tgt) link.targetPos = [tgt.x, tgt.y, tgt.z];
  }

  return { nodes, links };
}

// ---------------------------------------------------------------------------
// Highlight pulse tracking
// ---------------------------------------------------------------------------

export interface PulseEffect {
  nodeId: string;
  startTime: number;
  duration: number;
  color: string;
}

export interface LinkPulse {
  /** Either "source:target" or a nodeId (all links touching that node) */
  key: string;
  startTime: number;
  duration: number;
  color: string;
}

const PULSE_DURATION = 3000;
const LINK_PULSE_DURATION = 2500;

/**
 * Create node + link pulses from an `activity` SSE event.
 * The entityIds array contains prefixed IDs like "driver:email", "order:uuid".
 */
export function createActivityPulses(
  activityEvent: any,
): { nodePulses: PulseEffect[]; linkPulses: LinkPulse[] } {
  const now = Date.now();
  const entityIds: string[] = activityEvent.entityIds ?? [];
  const kind: string = activityEvent.kind ?? "";
  const nodePulses: PulseEffect[] = [];
  const linkPulses: LinkPulse[] = [];

  // Color based on activity kind
  const color =
    kind === "action" ? "#a855f7"  // purple for actions
    : kind === "result" ? (activityEvent.outcome === "executed" ? "#10b981" : activityEvent.outcome === "staged" ? "#eab308" : "#ef4444")
    : kind === "route" ? "#6366f1"  // indigo for routing
    : kind === "query" ? "#3b82f6"  // blue for queries
    : kind === "escalate" ? "#f97316" // orange for escalation
    : "#06b6d4"; // cyan default

  for (const eid of entityIds) {
    // Node pulse
    nodePulses.push({ nodeId: eid, startTime: now, duration: PULSE_DURATION, color });
    // Link pulse — highlight all edges touching this node
    linkPulses.push({ key: eid, startTime: now, duration: LINK_PULSE_DURATION, color });
  }

  // For action/result events with multiple entities, also pulse the direct link between them
  if (entityIds.length >= 2) {
    const pairKey = `${entityIds[0]}||${entityIds[1]}`;
    linkPulses.push({ key: pairKey, startTime: now, duration: LINK_PULSE_DURATION, color });
  }

  return { nodePulses, linkPulses };
}

/**
 * Check if a link should be highlighted given active link pulses.
 * Returns the pulse color if active, null otherwise.
 */
export function getLinkPulseColor(
  link: GraphLink,
  linkPulses: LinkPulse[],
): { color: string; progress: number } | null {
  const now = Date.now();
  // Resolve source/target — they may be objects at this point
  const sourceId = typeof link.source === "string" ? link.source : (link.source as any)?.id;
  const targetId = typeof link.target === "string" ? link.target : (link.target as any)?.id;

  for (const pulse of linkPulses) {
    const elapsed = now - pulse.startTime;
    if (elapsed >= pulse.duration) continue;

    const progress = elapsed / pulse.duration;

    // Match by node ID (any link touching this node)
    if (pulse.key === sourceId || pulse.key === targetId) {
      return { color: pulse.color, progress };
    }

    // Match by direct pair
    if (pulse.key === `${sourceId}||${targetId}` || pulse.key === `${targetId}||${sourceId}`) {
      return { color: pulse.color, progress };
    }
  }

  return null;
}

export function createAuditPulse(auditEvent: any): PulseEffect[] {
  const pulses: PulseEffect[] = [];
  const now = Date.now();

  const entityId = auditEvent.entityId;
  const actionType = auditEvent.actionType ?? "";
  const outcome = auditEvent.outcome;

  const color =
    outcome === "executed" ? "#10b981"
    : outcome === "staged" ? "#eab308"
    : "#ef4444";

  // Pulse the affected entity
  if (entityId && entityId !== "unknown") {
    // Try to figure out which node type
    if (actionType.includes("Order") || actionType.includes("Assign") || actionType.includes("Reassign")) {
      pulses.push({ nodeId: `order:${entityId}`, startTime: now, duration: PULSE_DURATION, color });
    }
    if (actionType.includes("Driver") || actionType.includes("Message") || actionType.includes("FollowUp")) {
      pulses.push({ nodeId: `driver:${entityId}`, startTime: now, duration: PULSE_DURATION, color });
    }
    if (actionType.includes("Ticket") || actionType.includes("Escalate") || actionType.includes("Resolve")) {
      pulses.push({ nodeId: `ticket:${entityId}`, startTime: now, duration: PULSE_DURATION, color });
    }
    if (actionType.includes("Market")) {
      pulses.push({ nodeId: `market:${entityId}`, startTime: now, duration: PULSE_DURATION, color });
    }
  }

  return pulses;
}
