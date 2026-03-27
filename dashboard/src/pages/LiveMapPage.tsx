import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CameraControls, Stars, Grid, Line, Billboard, Text } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { useOverview, useOrders, useDrivers, useRestaurants, useMarkets, useTickets } from "../api/hooks";
import { useSSEListener, type SSEEvent } from "../api/use-sse";
import {
  buildGraphData, createAuditPulse, createActivityPulses, getLinkPulseColor,
  type GraphNode, type GraphLink, type PulseEffect, type LinkPulse,
} from "../lib/graph-builder";
import { createEntityIcon, type IconEntityType } from "../lib/procedural-icons";
import { StatusBadge } from "../components/StatusBadge";

// ---------------------------------------------------------------------------
// Sizes per entity type
// ---------------------------------------------------------------------------

const SCALES: Record<string, number> = {
  market: 120, restaurant: 65, driver: 50, order: 38, ticket: 38,
};

// ---------------------------------------------------------------------------
// Scene content (runs inside R3F Canvas)
// ---------------------------------------------------------------------------

function SceneContent({
  graphData,
  pulseMap,
  linkPulses,
  selectedNode,
  onSelectNode,
}: {
  graphData: { nodes: GraphNode[]; links: GraphLink[] };
  pulseMap: Map<string, PulseEffect>;
  linkPulses: LinkPulse[];
  selectedNode: GraphNode | null;
  onSelectNode: (node: GraphNode | null) => void;
}) {
  const controlsRef = useRef<CameraControls>(null);
  const overviewPos = useMemo(() => ({ pos: new THREE.Vector3(0, 2000, 4000), target: new THREE.Vector3(0, 0, 0) }), []);

  // Fly to node on selection
  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    if (selectedNode) {
      const { x, y, z } = selectedNode;
      const s = (SCALES[selectedNode.entityType] ?? 6) * 3;
      c.setLookAt(x + s, y + s * 0.7, z + s, x, y, z, true);
    } else {
      c.setLookAt(
        overviewPos.pos.x, overviewPos.pos.y, overviewPos.pos.z,
        overviewPos.target.x, overviewPos.target.y, overviewPos.target.z,
        true,
      );
    }
  }, [selectedNode, overviewPos]);

  return (
    <>
      <CameraControls
        ref={controlsRef}
        smoothTime={0.8}
        dollySpeed={1.0}
        truckSpeed={1.0}
        makeDefault
      />

      {/* Environment */}
      <Stars radius={3000} depth={200} count={2500} factor={4} saturation={0.1} />
      <Grid
        infiniteGrid
        fadeDistance={10000}
        fadeStrength={1.5}
        cellSize={100}
        cellThickness={0.3}
        cellColor="#0a1a30"
        sectionSize={500}
        sectionThickness={0.6}
        sectionColor="#1a3050"
        position={[0, -200, 0]}
      />
      <fog attach="fog" args={["#000010", 2000, 12000]} />
      <ambientLight intensity={0.4} color="#334466" />
      <pointLight position={[0, 1500, 0]} intensity={0.3} color="#4488ff" distance={10000} />

      {/* Bloom */}
      <EffectComposer>
        <Bloom luminanceThreshold={0.4} luminanceSmoothing={0.9} intensity={0.6} />
      </EffectComposer>

      {/* Links */}
      {graphData.links.map((link, i) => (
        <EntityLink key={`${link.source}-${link.target}-${i}`} link={link} linkPulses={linkPulses} />
      ))}

      {/* Center logo */}
      <CenterLogo />

      {/* Nodes */}
      {graphData.nodes.map((node) => (
        <EntityNode
          key={node.id}
          node={node}
          isActive={pulseMap.has(node.id)}
          pulse={pulseMap.get(node.id)}
          isSelected={selectedNode?.id === node.id}
          onClick={() => onSelectNode(node)}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Entity node component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Center logo — holographic Valley Eats brand at the origin
// ---------------------------------------------------------------------------

function CenterLogo() {
  const texture = useMemo(() => new THREE.TextureLoader().load("https://valleyeats.ca/valley-eats-logo.png"), []);

  return (
    <group position={[0, -195, 0]}>
      {/* Logo flat on the ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[200, 64]} />
        <meshBasicMaterial map={texture} transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Subtle glow ring around logo */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.5, 0]}>
        <ringGeometry args={[200, 230, 64]} />
        <meshBasicMaterial color="#79A763" transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Entity node component
// ---------------------------------------------------------------------------

function EntityNode({
  node, isActive, pulse, isSelected, onClick,
}: {
  node: GraphNode;
  isActive: boolean;
  pulse?: PulseEffect;
  isSelected: boolean;
  onClick: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const s = SCALES[node.entityType] ?? 6;
  if (node.isLate && node.entityType === "order") { /* use 7 */ }
  const scale = node.isLate ? 7 : s;

  // Procedural icon (memoized — only recreated when color/type changes)
  const icon = useMemo(
    () => createEntityIcon(node.entityType as IconEntityType, {
      color: node.color,
      active: isActive,
      holoRing: node.entityType === "market",
      solidOpacity: isActive ? 0.35 : 0.12,
      wireOpacity: isActive ? 0.9 : 0.5,
    }),
    [node.entityType, node.color, isActive],
  );

  // Idle rotation
  useFrame((_, dt) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += dt * 0.15;
    }
  });

  const labelColor = isActive ? "#ffffff" : (node.entityType === "market" ? "#6699cc" : "#ffffff60");
  const labelSize = node.entityType === "market" ? 16 : 10;

  return (
    <group ref={groupRef} position={[node.x, node.y, node.z]} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {/* 3D Icon */}
      <primitive object={icon} scale={scale} />

      {/* Holographic base plate */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -scale * 0.35, 0]}>
        <ringGeometry args={[scale * 0.5, scale * 0.7, 32]} />
        <meshBasicMaterial color={node.color} transparent opacity={isActive ? 0.25 : 0.08} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* Selection ring */}
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -scale * 0.35, 0]}>
          <ringGeometry args={[scale * 0.8, scale * 0.9, 32]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}

      {/* Active pulse ring */}
      {pulse && <PulseRing pulse={pulse} baseScale={scale} />}

      {/* Late glow */}
      {node.isLate && (
        <mesh>
          <sphereGeometry args={[scale * 0.6, 12, 8]} />
          <meshBasicMaterial color="#ff2222" transparent opacity={0.1} depthWrite={false} />
        </mesh>
      )}

      {/* Label */}
      <Billboard position={[0, -(scale * 0.45 + 4), 0]}>
        <Text
          fontSize={labelSize}
          color={labelColor}
          anchorX="center"
          anchorY="top"
        >
          {node.label}
        </Text>
      </Billboard>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Pulse ring (animated expanding ring)
// ---------------------------------------------------------------------------

function PulseRing({ pulse, baseScale }: { pulse: PulseEffect; baseScale: number }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!meshRef.current) return;
    const elapsed = Date.now() - pulse.startTime;
    const progress = Math.min(elapsed / pulse.duration, 1);
    const s = baseScale * (1.2 + progress * 3);
    meshRef.current.scale.setScalar(s);
    (meshRef.current.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.4;
  });

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -baseScale * 0.3, 0]}>
      <ringGeometry args={[0.6, 1, 32]} />
      <meshBasicMaterial color={pulse.color} transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Link component
// ---------------------------------------------------------------------------

function EntityLink({ link, linkPulses }: { link: GraphLink; linkPulses: LinkPulse[] }) {
  const pulse = getLinkPulseColor(link, linkPulses);
  const isActive = !!pulse;
  const color = isActive ? pulse!.color : link.color;
  const opacity = isActive
    ? 0.7 * (1 - pulse!.progress * 0.4)
    : link.type === "order-driver" ? 0.25
    : link.type?.includes("market") ? 0.1
    : 0.12;
  const width = isActive ? 3 + 4 * (1 - pulse!.progress) : Math.max(link.width * 1.5, 0.8);

  // Skip rendering if positions are both at origin (dead link)
  if (link.sourcePos[0] === 0 && link.sourcePos[2] === 0 && link.targetPos[0] === 0 && link.targetPos[2] === 0) return null;

  return (
    <group>
      <Line
        points={[link.sourcePos, link.targetPos]}
        color={color}
        lineWidth={width}
        transparent
        opacity={opacity}
      />
      {/* Bright glow line on active */}
      {isActive && (
        <Line
          points={[link.sourcePos, link.targetPos]}
          color={pulse!.color}
          lineWidth={width + 4}
          transparent
          opacity={0.15 * (1 - pulse!.progress)}
        />
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function LiveMapPage() {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [pulses, setPulses] = useState<PulseEffect[]>([]);
  const [linkPulses, setLinkPulses] = useState<LinkPulse[]>([]);
  const [activityLog, setActivityLog] = useState<SSEEvent[]>([]);

  const { data: overview } = useOverview();
  const { data: orders } = useOrders();
  const { data: drivers } = useDrivers();
  const { data: restaurants } = useRestaurants();
  const { data: markets } = useMarkets();
  const { data: tickets } = useTickets();

  const graphData = useMemo(() => {
    if (!orders || !drivers || !restaurants || !markets || !tickets) return { nodes: [], links: [] };
    return buildGraphData(orders, drivers, restaurants, markets, tickets);
  }, [orders, drivers, restaurants, markets, tickets]);

  // Track pointer to distinguish tap from drag/orbit/pan
  const pointerDown = useRef<{ x: number; y: number; time: number } | null>(null);
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerDown.current = { x: e.clientX, y: e.clientY, time: Date.now() };
  }, []);
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!pointerDown.current) return;
    const dx = e.clientX - pointerDown.current.x;
    const dy = e.clientY - pointerDown.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const elapsed = Date.now() - pointerDown.current.time;
    pointerDown.current = null;
    // Only deselect on a quick tap with minimal movement
    if (dist < 5 && elapsed < 300 && selectedNode) {
      setSelectedNode(null);
    }
  }, [selectedNode]);

  // SSE
  useSSEListener(useCallback((event: SSEEvent) => {
    if (event.type === "activity" || event.type === "audit" || event.type === "cycle") {
      setActivityLog(p => { const n = [event, ...p]; if (n.length > 50) n.length = 50; return n; });
    }
    if (event.type === "audit") {
      const p = createAuditPulse(event.data);
      if (p.length) setPulses(prev => [...prev, ...p]);
    }
    if (event.type === "activity") {
      const { nodePulses, linkPulses: lp } = createActivityPulses(event.data);
      if (nodePulses.length) setPulses(prev => [...prev, ...nodePulses]);
      if (lp.length) setLinkPulses(prev => [...prev, ...lp]);
    }
  }, []));

  // Expire pulses
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setPulses(p => { const f = p.filter(x => now - x.startTime < x.duration); return f.length === p.length ? p : f; });
      setLinkPulses(p => { const f = p.filter(x => now - x.startTime < x.duration); return f.length === p.length ? p : f; });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const pulseMap = useMemo(() => {
    const m = new Map<string, PulseEffect>();
    for (const p of pulses) m.set(p.nodeId, p);
    return m;
  }, [pulses]);

  const syncAge = overview?.stats?.lastSyncedAt
    ? Math.round((Date.now() - new Date(overview.stats.lastSyncedAt).getTime()) / 1000) : null;

  return (
    <div className="fixed inset-0 bg-[#000008]">
      {/* R3F Canvas */}
      <Canvas
        camera={{ position: [0, 2000, 4000], fov: 60, near: 1, far: 20000 }}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        style={{ background: "#000008" }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <SceneContent
          graphData={graphData}
          pulseMap={pulseMap}
          linkPulses={linkPulses}
          selectedNode={selectedNode}
          onSelectNode={setSelectedNode}
        />
      </Canvas>

      {/* === HUD Overlay === */}

      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 pointer-events-none">
        <div className="pointer-events-auto flex items-center justify-between px-5 py-3"
             style={{ background: "linear-gradient(180deg, #000008ee 60%, transparent 100%)" }}>
          <div className="flex items-center gap-4">
            <span className="text-cyan-400/60 text-[11px] font-mono font-bold tracking-[0.35em]">SISYPHUS</span>
            <span className="w-px h-3.5 bg-cyan-800/20" />
            <StatusBadge value={overview?.health?.status ?? "unknown"} />
            {syncAge !== null && (
              <span className="text-[10px] text-cyan-700/40 font-mono">
                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle ${syncAge < 30 ? "bg-cyan-400/70" : syncAge < 60 ? "bg-yellow-400/70" : "bg-red-400/70"}`} />
                {syncAge}s
              </span>
            )}
          </div>
          <div className="flex items-center gap-5 text-[10px] font-mono text-cyan-700/35 tracking-wider">
            <span>{overview?.stats?.orders ?? 0} ord</span>
            <span>{overview?.stats?.drivers ?? 0} drv</span>
            <span>{overview?.stats?.restaurants ?? 0} rst</span>
            <span>{overview?.stats?.tickets ?? 0} tkt</span>
            <span>{overview?.stats?.markets ?? 0} mkt</span>
            <Link to="/overview" className="text-cyan-500/40 hover:text-cyan-300 transition-colors">tables &rarr;</Link>
          </div>
        </div>
      </div>

      {/* Markets quick-select */}
      <div className="absolute top-14 right-4 w-44 max-h-[50vh] pointer-events-auto bg-[#00000cdd] border border-cyan-900/15 rounded backdrop-blur-sm overflow-hidden">
        <div className="px-3 py-1.5 border-b border-cyan-900/10 text-[9px] font-mono text-cyan-600/35 tracking-[0.2em]">MARKETS</div>
        <div className="overflow-auto max-h-[calc(50vh-30px)]">
          {graphData.nodes.filter(n => n.entityType === "market").map(m => (
            <button
              key={m.id}
              onClick={() => setSelectedNode(m)}
              className={`w-full text-left px-3 py-1.5 text-[10px] font-mono transition-colors hover:bg-cyan-900/20 ${selectedNode?.id === m.id ? "bg-cyan-900/30 text-cyan-300" : "text-cyan-500/50"}`}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ backgroundColor: m.color, opacity: 0.7 }} />
              {m.label}
            </button>
          ))}
        </div>
      </div>


      {/* Activity feed */}
      <div className="absolute bottom-4 right-4 w-80 max-h-72 pointer-events-auto bg-[#00000cdd] border border-cyan-900/15 rounded backdrop-blur-sm overflow-hidden">
        <div className="px-3 py-1.5 border-b border-cyan-900/10 text-[9px] font-mono text-cyan-600/35 tracking-[0.2em]">AI ACTIVITY</div>
        <div className="overflow-auto max-h-60 divide-y divide-cyan-900/6">
          {activityLog.length === 0
            ? <p className="px-3 py-3 text-[10px] text-cyan-800/25 font-mono">awaiting events...</p>
            : activityLog.map((e, i) => <ActivityItem key={`${e.timestamp.getTime()}-${i}`} event={e} />)
          }
        </div>
      </div>

      {/* Detail panel */}
      {selectedNode && <DetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HUD sub-components
// ---------------------------------------------------------------------------

const KC: Record<string, string> = { route:"text-indigo-400", action:"text-purple-400", query:"text-blue-400/40", lookup:"text-cyan-500/40", escalate:"text-orange-400", result:"text-emerald-400", done:"text-cyan-700/30", summary:"text-cyan-800/25" };
const KL: Record<string, string> = { route:"ROUTE", action:"ACTION", query:"QUERY", lookup:"LOOKUP", escalate:"ESCALATE", result:"RESULT", done:"DONE", summary:"SUMMARY" };

function ActivityItem({ event }: { event: SSEEvent }) {
  const t = event.timestamp.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" });
  if (event.type === "activity") {
    const d = event.data;
    const rc = d.outcome === "executed" ? "text-emerald-400" : d.outcome === "staged" ? "text-yellow-400" : d.outcome === "rejected" ? "text-red-400" : "";
    return (
      <div className="px-3 py-1 text-[10px] font-mono">
        <div className="flex items-center gap-1.5"><span className="text-cyan-800/25 min-w-[58px]">{t}</span><span className={`font-medium ${KC[d.kind]??"text-cyan-700/25"}`}>{KL[d.kind]??d.kind}</span><span className="text-cyan-700/15">{d.agent}</span></div>
        <div className="ml-[62px] text-cyan-300/45 truncate">{d.kind==="result"?<span className={rc}>{d.summary}</span>:d.summary}</div>
      </div>
    );
  }
  if (event.type === "audit") {
    const d = event.data;
    const oc = d.outcome==="executed"?"text-emerald-400":d.outcome==="staged"?"text-yellow-400":"text-red-400";
    return (
      <div className="px-3 py-1 text-[10px] font-mono bg-purple-900/5">
        <span className="text-cyan-800/25 min-w-[58px] inline-block">{t}</span>
        <span className="text-purple-400/60 font-medium ml-1">AUDIT</span>
        <span className="text-white/60 ml-1">{d.actionType}</span>
        <span className={`ml-1 ${oc}`}>{d.outcome}</span>
      </div>
    );
  }
  if (event.type === "cycle") {
    if (!event.data.graphInvoked) return null;
    return <div className="px-3 py-1 text-[10px] font-mono"><span className="text-cyan-800/25">{t}</span><span className="text-cyan-500/30 ml-1.5">cycle #{event.data.cycleNumber} ({event.data.changesDetected}chg)</span></div>;
  }
  return null;
}

function fmtTime(d: any): string | undefined {
  if (!d) return undefined;
  try { return new Date(d).toLocaleTimeString(); } catch { return undefined; }
}
function fmtCents(c: any): string | undefined {
  if (c == null) return undefined;
  return `$${(c / 100).toFixed(2)}`;
}

function DetailPanel({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  const r = node.raw;
  return (
    <div className="absolute top-14 left-4 w-80 pointer-events-auto bg-[#00000cee] border border-cyan-900/15 rounded backdrop-blur-sm overflow-hidden shadow-2xl shadow-cyan-900/20">
      <div className="flex items-center justify-between px-3 py-2 border-b border-cyan-900/10">
        <div>
          <div className="text-[8px] text-cyan-700/25 font-mono tracking-[0.2em] uppercase">{node.entityType}</div>
          <div className="text-cyan-200/80 font-mono font-semibold text-sm">{node.label}</div>
        </div>
        <button onClick={onClose} className="text-cyan-700/25 hover:text-cyan-300 text-lg">&times;</button>
      </div>
      <div className="px-3 py-2 max-h-[60vh] overflow-auto space-y-1 text-[10px] font-mono">
        {node.sublabel && <p className="text-cyan-500/35 mb-1">{node.sublabel}</p>}

        {/* ORDER — full detail */}
        {node.entityType === "order" && <>
          <Hdr t="Status" />
          <R l="status" v={r.status} /><R l="type" v={r.orderType} /><R l="delivery" v={r.deliveryType} />
          <R l="ASAP" v={r.isAsap ? "yes" : "no"} /><R l="late" v={r.isLate ? "YES" : "no"} />
          <R l="wait" v={r.waitTimeMinutes != null ? `${r.waitTimeMinutes}m` : undefined} />
          <R l="since ready" v={r.timeSinceReady != null ? `${r.timeSinceReady}m` : undefined} />
          <Hdr t="Participants" />
          <R l="customer" v={r.customerId} /><R l="driver" v={r.driverId} /><R l="restaurant" v={r.restaurantName} />
          <Hdr t="Delivery" />
          <R l="zone" v={r.deliveryZone} /><R l="street" v={r.deliveryStreet} />
          <R l="city" v={r.deliveryCity} /><R l="province" v={r.deliveryProvince} />
          <R l="distance" v={r.deliveryDistance != null ? `${r.deliveryDistance}m` : undefined} />
          <R l="instructions" v={r.deliveryInstructions} />
          <Hdr t="Financials" />
          <R l="subtotal" v={fmtCents(r.subtotal)} /><R l="tax" v={fmtCents(r.tax)} />
          <R l="delivery fee" v={fmtCents(r.deliveryFee)} /><R l="tip" v={fmtCents(r.tip)} />
          <R l="total" v={fmtCents(r.total)} /><R l="alcohol" v={r.hasAlcohol ? "yes" : "no"} />
          <Hdr t="Timeline" />
          <R l="placed" v={fmtTime(r.placedAt)} /><R l="confirmed" v={fmtTime(r.confirmedAt)} />
          <R l="driver assigned" v={fmtTime(r.driverAssignedAt)} /><R l="ready" v={fmtTime(r.readyAt)} />
          <R l="in bag" v={fmtTime(r.inBagAt)} /><R l="en route" v={fmtTime(r.enrouteAt)} />
          <R l="in transit" v={fmtTime(r.inTransitAt)} /><R l="at customer" v={fmtTime(r.atCustomerAt)} />
          <R l="delivered" v={fmtTime(r.deliveredAt)} />
          <R l="travel time" v={r.travelTime != null ? `${Math.round(r.travelTime / 60)}m` : undefined} />
          {r.items?.length > 0 && <>
            <Hdr t={`Items (${r.items.length})`} />
            {r.items.map((item: any, i: number) => (
              <div key={i} className="flex justify-between">
                <span className="text-cyan-500/40">{item.quantity}x {item.itemName}</span>
                <span className="text-cyan-300/50">{fmtCents(item.price)}</span>
              </div>
            ))}
          </>}
        </>}

        {/* DRIVER — full detail */}
        {node.entityType === "driver" && <>
          <Hdr t="Identity" />
          <R l="email" v={r.driverId} /><R l="name" v={r.name} /><R l="phone" v={r.phone} />
          <R l="monacher" v={r.monacher} />
          <Hdr t="Status" />
          <R l="status" v={r.status} /><R l="online" v={r.isOnline ? "yes" : "no"} />
          <R l="available" v={r.isAvailable ? "yes" : "no"} /><R l="paused" v={r.isPaused ? "yes" : "no"} />
          <R l="active" v={r.isActive ? "yes" : "no"} />
          <R l="active orders" v={r.activeOrdersCount?.toString()} />
          <Hdr t="Zone" />
          <R l="dispatch zone" v={r.dispatchZone} /><R l="delivery area" v={r.deliveryArea} />
          <R l="ignore area" v={r.ignoreArea ? "yes" : "no"} />
          <Hdr t="Device" />
          <R l="connected" v={r.connectionId ? "yes" : "no"} />
          <R l="app version" v={r.appVersion} /><R l="phone model" v={r.phoneModel} />
          <R l="training orders" v={r.trainingOrders?.toString()} />
          {r.appSettings && <>
            <R l="geo permission" v={r.appSettings.geoLocate} />
            <R l="camera" v={r.appSettings.camera} /><R l="phone perm" v={r.appSettings.phone} />
          </>}
        </>}

        {/* RESTAURANT — full detail */}
        {node.entityType === "restaurant" && <>
          <Hdr t="Identity" />
          <R l="name" v={r.name} /><R l="ID" v={r.restaurantIdKey} />
          <R l="phone" v={r.phone} /><R l="email" v={r.email} />
          <Hdr t="Location" />
          <R l="zone" v={r.deliveryZone} /><R l="city" v={r.city} /><R l="province" v={r.province} />
          <Hdr t="Details" />
          <R l="cuisine" v={r.cuisine} /><R l="price level" v={r.priceLevel?.toString()} />
          <R l="commission" v={r.commission != null ? `${(r.commission * 100).toFixed(0)}%` : undefined} />
          <Hdr t="Operations" />
          <R l="open" v={r.isOpen ? "yes" : "no"} /><R l="active" v={r.isActive ? "yes" : "no"} />
          <R l="delivery available" v={r.deliveryAvailable ? "yes" : "no"} />
          <R l="tablet online" v={r.isTabletOnline ? "yes" : "no"} />
          <R l="POS ETA" v={r.posEta != null ? `${r.posEta}m` : undefined} />
          <R l="health score" v={r.healthScore?.toString()} /><R l="alert" v={r.alertLevel} />
          <R l="current load" v={r.currentLoad?.toString()} />
        </>}

        {/* MARKET — full detail */}
        {node.entityType === "market" && <>
          <Hdr t="Metrics" />
          <R l="score" v={r.score?.toString()} /><R l="demand" v={r.demandLevel} />
          <R l="available drivers" v={r.availableDrivers?.toString()} />
          <R l="ideal drivers" v={r.idealDrivers?.toString()} />
          <R l="driver gap" v={r.driverGap?.toString()} />
          <R l="active orders" v={r.activeOrders?.toString()} />
          <R l="driver:order ratio" v={r.driverToOrderRatio != null ? r.driverToOrderRatio.toFixed(2) : undefined} />
          <R l="ETA" v={r.eta != null ? `${r.eta}m` : undefined} />
          <R l="last updated" v={fmtTime(r.lastUpdated)} />
          {r.demandPredictionMeta && <>
            <Hdr t="Prediction Model" />
            <R l="confidence" v={r.demandPredictionMeta.modelConfidence} />
            <R l="period" v={r.demandPredictionMeta.predictionPeriod} />
            <R l="data points" v={r.demandPredictionMeta.trainingDataPoints?.toString()} />
          </>}
        </>}

        {/* TICKET — full detail */}
        {node.entityType === "ticket" && <>
          <Hdr t="Issue" />
          <R l="ID" v={r.issueId} /><R l="status" v={r.status} />
          <R l="category" v={r.category} /><R l="type" v={r.issueType} />
          <R l="created" v={fmtTime(r.createdAt)} />
          <Hdr t="Linked Entities" />
          <R l="order" v={r.orderIdKey} /><R l="restaurant" v={r.restaurantName} />
          <R l="driver" v={r.driverId} /><R l="market" v={r.market} />
          <Hdr t="People" />
          <R l="originator" v={r.originator} /><R l="owner" v={r.owner} />
          <Hdr t="Content" />
          {r.description && <p className="text-cyan-400/40 text-[10px] leading-relaxed">{r.description}</p>}
          {r.resolution && <><Hdr t="Resolution" /><p className="text-emerald-400/50 text-[10px]">{r.resolution}</p></>}
          {r.actions?.length > 0 && <>
            <Hdr t={`History (${r.actions.length})`} />
            {r.actions.map((a: any, i: number) => (
              <div key={i} className="text-[9px] text-cyan-600/30">{fmtTime(a.timestamp)} — {a.actor}: {a.description}</div>
            ))}
          </>}
          {r.messages?.length > 0 && <>
            <Hdr t={`Messages (${r.messages.length})`} />
            {r.messages.map((m: any, i: number) => (
              <div key={i} className="text-[9px]"><span className="text-cyan-500/40">{m.originator?.split("@")[0]}</span> <span className="text-cyan-600/30">{m.message}</span></div>
            ))}
          </>}
          {r.notes?.length > 0 && <>
            <Hdr t={`Notes (${r.notes.length})`} />
            {r.notes.map((n: any, i: number) => (
              <div key={i} className="text-[9px] text-cyan-600/30">{n.author}: {n.note}</div>
            ))}
          </>}
        </>}
      </div>
    </div>
  );
}

function Hdr({ t }: { t: string }) {
  return <div className="text-[9px] text-cyan-600/30 uppercase tracking-wider mt-2 mb-0.5 border-t border-cyan-900/10 pt-1.5">{t}</div>;
}

function R({ l, v }: { l: string; v?: string|null }) {
  if (!v) return null;
  return <div className="flex justify-between"><span className="text-cyan-700/25">{l}</span><span className="text-cyan-300/50">{v}</span></div>;
}
