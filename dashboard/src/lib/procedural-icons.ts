/**
 * Procedural 3D icon geometry for holographic dashboard nodes.
 *
 * Each entity type is built from composed Three.js geometry primitives --
 * no external model files needed. Designed for a cyberpunk/holographic look
 * with wireframe overlays and emissive glow.
 *
 * Usage:
 *   const group = createEntityIcon("order", "#3b82f6");
 *   scene.add(group);
 *
 * All icons are unit-scale (~1 world unit bounding box) so callers can
 * scale uniformly with group.scale.setScalar(desiredSize).
 */

import * as THREE from "three";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IconEntityType = "order" | "driver" | "restaurant" | "market" | "ticket";

export interface IconOptions {
  /** Base emissive/wireframe color (hex string). */
  color: string;
  /** Show solid fill (lower opacity) behind wireframe. Default true. */
  solid?: boolean;
  /** Wireframe overlay. Default true. */
  wireframe?: boolean;
  /** Opacity of the solid fill (0..1). Default 0.15. */
  solidOpacity?: number;
  /** Opacity of the wireframe (0..1). Default 0.6. */
  wireOpacity?: number;
  /** Add outer holographic scan-ring. Default false. */
  holoRing?: boolean;
  /** Whether the node is "active" (pulsing, brighter). Default false. */
  active?: boolean;
}

const DEFAULTS: Required<IconOptions> = {
  color: "#06b6d4",
  solid: true,
  wireframe: true,
  solidOpacity: 0.15,
  wireOpacity: 0.6,
  holoRing: false,
  active: false,
};

// ---------------------------------------------------------------------------
// Geometry cache (shared across all icons of the same type)
// ---------------------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry[]>();

// ---------------------------------------------------------------------------
// Material factories (not cached -- callers may want unique colors)
// ---------------------------------------------------------------------------

function solidMat(color: string, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function wireMat(color: string, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    wireframe: true,
    transparent: true,
    opacity,
    depthWrite: false,
  });
}

function edgeMat(color: string, opacity: number): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a procedural 3D icon Group for the given entity type.
 * Returns a THREE.Group scaled to approximately 1 world unit.
 */
export function createEntityIcon(
  entityType: IconEntityType,
  opts?: Partial<IconOptions>,
): THREE.Group {
  const o: Required<IconOptions> = { ...DEFAULTS, ...opts };
  const group = new THREE.Group();
  group.userData.entityType = entityType;

  const builder = BUILDERS[entityType];
  if (!builder) return group;

  const geometries = getCachedGeometries(entityType, builder);

  for (const geo of geometries) {
    if (o.solid) {
      group.add(new THREE.Mesh(geo, solidMat(o.color, o.active ? o.solidOpacity * 2.5 : o.solidOpacity)));
    }
    if (o.wireframe) {
      const edges = new THREE.EdgesGeometry(geo, 15);
      group.add(new THREE.LineSegments(edges, edgeMat(o.color, o.active ? 1 : o.wireOpacity)));
    }
  }

  if (o.holoRing) {
    const ring = new THREE.RingGeometry(0.55, 0.6, 32);
    const ringMesh = new THREE.Mesh(ring, solidMat(o.color, o.active ? 0.35 : 0.12));
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = -0.35;
    group.add(ringMesh);
  }

  return group;
}

/**
 * Convenience: create all five entity icons as a Record, for previews / legends.
 */
export function createAllIcons(opts?: Partial<IconOptions>): Record<IconEntityType, THREE.Group> {
  return {
    order: createEntityIcon("order", opts),
    driver: createEntityIcon("driver", opts),
    restaurant: createEntityIcon("restaurant", opts),
    market: createEntityIcon("market", opts),
    ticket: createEntityIcon("ticket", opts),
  };
}

/**
 * Dispose all cached geometries (call on unmount if needed).
 */
export function disposeIconGeometries(): void {
  geoCache.forEach((geos) => {
    for (const g of geos) g.dispose();
  });
  geoCache.clear();
}

// ---------------------------------------------------------------------------
// Geometry builders -- each returns an array of BufferGeometry
// ---------------------------------------------------------------------------

type GeoBuilder = () => THREE.BufferGeometry[];

function getCachedGeometries(key: string, builder: GeoBuilder): THREE.BufferGeometry[] {
  if (geoCache.has(key)) return geoCache.get(key)!;
  const geos = builder();
  geoCache.set(key, geos);
  return geos;
}

// -- ORDER: Shopping bag --------------------------------------------------

function buildOrderGeo(): THREE.BufferGeometry[] {
  const geos: THREE.BufferGeometry[] = [];

  // Bag body -- tapered box (wider at top)
  // We approximate with a cylinder (4 radial segments = square cross-section)
  const body = new THREE.CylinderGeometry(0.32, 0.26, 0.5, 4, 1);
  body.rotateY(Math.PI / 4); // align edges to axis
  body.translate(0, 0, 0);
  geos.push(body);

  // Handle -- torus arc
  const handle = new THREE.TorusGeometry(0.12, 0.015, 6, 12, Math.PI);
  handle.translate(0, 0.32, 0);
  geos.push(handle);

  // Flap line (top of bag) -- thin box
  const flap = new THREE.BoxGeometry(0.52, 0.015, 0.36);
  flap.translate(0, 0.25, 0);
  geos.push(flap);

  return geos;
}

// -- DRIVER: Delivery car ------------------------------------------------

function buildDriverGeo(): THREE.BufferGeometry[] {
  const geos: THREE.BufferGeometry[] = [];

  // Chassis (lower body)
  const chassis = new THREE.BoxGeometry(0.6, 0.14, 0.3);
  chassis.translate(0, -0.05, 0);
  geos.push(chassis);

  // Cabin (upper body, slightly smaller and offset forward)
  const cabin = new THREE.BoxGeometry(0.32, 0.14, 0.26);
  cabin.translate(0.04, 0.09, 0);
  geos.push(cabin);

  // Windshield (angled face -- thin box rotated)
  const windshield = new THREE.BoxGeometry(0.01, 0.12, 0.22);
  windshield.rotateZ(Math.PI * 0.15);
  windshield.translate(-0.13, 0.08, 0);
  geos.push(windshield);

  // Wheels (4 cylinders)
  const wheelGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.04, 8);
  wheelGeo.rotateX(Math.PI / 2);

  const positions = [
    [-0.2, -0.12, 0.17],
    [-0.2, -0.12, -0.17],
    [0.2, -0.12, 0.17],
    [0.2, -0.12, -0.17],
  ];

  for (const [x, y, z] of positions) {
    const w = wheelGeo.clone();
    w.translate(x, y, z);
    geos.push(w);
  }

  // Delivery box on top (small box on rear)
  const box = new THREE.BoxGeometry(0.16, 0.1, 0.2);
  box.translate(-0.18, 0.12, 0);
  geos.push(box);

  return geos;
}

// -- RESTAURANT: Storefront building -------------------------------------

function buildRestaurantGeo(): THREE.BufferGeometry[] {
  const geos: THREE.BufferGeometry[] = [];

  // Main building
  const building = new THREE.BoxGeometry(0.5, 0.4, 0.35);
  building.translate(0, 0, 0);
  geos.push(building);

  // Roof -- slightly wider flat box
  const roof = new THREE.BoxGeometry(0.58, 0.04, 0.4);
  roof.translate(0, 0.22, 0);
  geos.push(roof);

  // Awning -- thin wedge (approximated with a box, slightly rotated)
  const awning = new THREE.BoxGeometry(0.5, 0.02, 0.12);
  awning.rotateX(Math.PI * 0.06);
  awning.translate(0, 0.08, 0.22);
  geos.push(awning);

  // Door
  const door = new THREE.BoxGeometry(0.1, 0.2, 0.01);
  door.translate(0, -0.1, 0.18);
  geos.push(door);

  // Windows (two)
  const winL = new THREE.BoxGeometry(0.1, 0.1, 0.01);
  winL.translate(-0.15, 0.04, 0.18);
  geos.push(winL);

  const winR = new THREE.BoxGeometry(0.1, 0.1, 0.01);
  winR.translate(0.15, 0.04, 0.18);
  geos.push(winR);

  // Sign above door (small flat box)
  const sign = new THREE.BoxGeometry(0.2, 0.05, 0.01);
  sign.translate(0, 0.16, 0.18);
  geos.push(sign);

  return geos;
}

// -- MARKET: Globe with latitude/longitude rings -------------------------

function buildMarketGeo(): THREE.BufferGeometry[] {
  const geos: THREE.BufferGeometry[] = [];

  // Core sphere (low-poly icosahedron for cyberpunk look)
  const sphere = new THREE.IcosahedronGeometry(0.3, 1);
  geos.push(sphere);

  // Equatorial ring
  const ring1 = new THREE.TorusGeometry(0.35, 0.008, 4, 32);
  geos.push(ring1);

  // Tilted longitude ring
  const ring2 = new THREE.TorusGeometry(0.33, 0.008, 4, 32);
  ring2.rotateY(Math.PI / 2);
  geos.push(ring2);

  // Second longitude ring (45 degrees)
  const ring3 = new THREE.TorusGeometry(0.33, 0.008, 4, 32);
  ring3.rotateY(Math.PI / 4);
  geos.push(ring3);

  // Latitude ring (tropic)
  const tropicR = 0.3 * Math.cos(Math.PI / 6); // cos(30deg)
  const tropicY = 0.3 * Math.sin(Math.PI / 6);
  const ring4 = new THREE.TorusGeometry(tropicR, 0.006, 4, 24);
  ring4.rotateX(Math.PI / 2);
  ring4.translate(0, tropicY, 0);
  geos.push(ring4);

  const ring5 = new THREE.TorusGeometry(tropicR, 0.006, 4, 24);
  ring5.rotateX(Math.PI / 2);
  ring5.translate(0, -tropicY, 0);
  geos.push(ring5);

  // Orbital marker -- small octahedron
  const marker = new THREE.OctahedronGeometry(0.04, 0);
  marker.translate(0.35, 0, 0);
  geos.push(marker);

  return geos;
}

// -- TICKET: Alert/warning triangle with exclamation ---------------------

function buildTicketGeo(): THREE.BufferGeometry[] {
  const geos: THREE.BufferGeometry[] = [];

  // Triangle body -- use a cone with 3 radial segments
  const tri = new THREE.ConeGeometry(0.32, 0.45, 3, 1);
  tri.rotateY(Math.PI / 6); // orient a flat face forward
  tri.translate(0, 0.02, 0);
  geos.push(tri);

  // Exclamation mark stem -- thin tall box
  const stem = new THREE.BoxGeometry(0.03, 0.14, 0.03);
  stem.translate(0, 0.04, 0.06);
  geos.push(stem);

  // Exclamation mark dot -- small sphere
  const dot = new THREE.SphereGeometry(0.025, 6, 4);
  dot.translate(0, -0.07, 0.06);
  geos.push(dot);

  // Base line
  const base = new THREE.BoxGeometry(0.36, 0.015, 0.04);
  base.translate(0, -0.21, 0);
  geos.push(base);

  return geos;
}

const BUILDERS: Record<IconEntityType, GeoBuilder> = {
  order: buildOrderGeo,
  driver: buildDriverGeo,
  restaurant: buildRestaurantGeo,
  market: buildMarketGeo,
  ticket: buildTicketGeo,
};

// ---------------------------------------------------------------------------
// Animation helpers (optional -- callers can use in their render loop)
// ---------------------------------------------------------------------------

/**
 * Apply a slow idle rotation + bob to an icon group.
 * Call each frame with elapsed time in seconds.
 */
export function animateIcon(group: THREE.Group, elapsed: number, speed = 1): void {
  group.rotation.y = elapsed * 0.3 * speed;
  group.position.y = Math.sin(elapsed * 0.8 * speed) * 0.05;
}

/**
 * Apply a holographic "glitch" displacement (call sparingly for effect).
 * Returns true while active, false when complete.
 */
export function glitchIcon(group: THREE.Group, elapsed: number, duration = 0.3): boolean {
  if (elapsed > duration) {
    group.position.x = 0;
    group.position.z = 0;
    return false;
  }
  const intensity = 1 - elapsed / duration;
  group.position.x = (Math.random() - 0.5) * 0.05 * intensity;
  group.position.z = (Math.random() - 0.5) * 0.05 * intensity;
  return true;
}
