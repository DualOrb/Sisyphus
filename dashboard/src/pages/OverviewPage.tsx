import { useOverview } from "../api/hooks";
import { StatusBadge } from "../components/StatusBadge";

const ENTITY_LABELS: [string, string][] = [
  ["orders", "Orders"],
  ["drivers", "Drivers"],
  ["restaurants", "Restaurants"],
  ["customers", "Customers"],
  ["tickets", "Tickets"],
  ["markets", "Markets"],
  ["conversations", "Conversations"],
];

function CountCard({ label, count }: { label: string; count: number }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">{count}</p>
    </div>
  );
}

function ShiftStatsPanel({ shift }: { shift: any }) {
  if (!shift) return null;
  const items = [
    ["Dispatch Cycles", shift.dispatchCycles],
    ["Ontology Syncs", shift.ontologySyncs],
    ["Actions Executed", shift.actionsExecuted],
    ["Errors", shift.errorsEncountered],
    ["Browser Reconnects", shift.browserReconnections],
  ];
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-gray-300 mb-3">Shift Stats</h3>
      <div className="space-y-2">
        {items.map(([label, value]) => (
          <div key={label as string} className="flex justify-between text-sm">
            <span className="text-gray-500">{label}</span>
            <span className="text-white font-mono">{value ?? 0}</span>
          </div>
        ))}
        {shift.shiftStartedAt && (
          <div className="flex justify-between text-sm pt-2 border-t border-gray-800">
            <span className="text-gray-500">Started</span>
            <span className="text-gray-400 text-xs">
              {new Date(shift.shiftStartedAt).toLocaleTimeString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ComponentHealth({ components }: { components: any[] }) {
  if (!components?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-gray-300 mb-3">Components</h3>
      <div className="space-y-2">
        {components.map((c: any) => (
          <div key={c.name} className="flex items-center justify-between text-sm">
            <span className="text-gray-400">{c.name}</span>
            <div className="flex items-center gap-2">
              {c.latencyMs != null && (
                <span className="text-xs text-gray-600 font-mono">{c.latencyMs}ms</span>
              )}
              <StatusBadge value={c.status} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OverviewPage() {
  const { data, isLoading, error } = useOverview();

  if (isLoading) {
    return <p className="text-gray-500">Loading...</p>;
  }
  if (error) {
    return (
      <p className="text-red-400">
        Failed to load overview. Is Sisyphus running on port 3000?
      </p>
    );
  }
  if (!data) return null;

  const syncAge = data.stats?.lastSyncedAt
    ? Math.round((Date.now() - new Date(data.stats.lastSyncedAt).getTime()) / 1000)
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Overview</h2>
        <div className="flex items-center gap-4">
          <StatusBadge value={data.health?.status ?? "unknown"} />
          {syncAge !== null && (
            <span className="text-xs text-gray-500">
              Last sync: {syncAge}s ago
            </span>
          )}
          <span className="text-xs text-gray-600">
            Uptime: {formatUptime(data.uptime)}
          </span>
        </div>
      </div>

      {/* Entity counts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {ENTITY_LABELS.map(([key, label]) => (
          <CountCard key={key} label={label} count={data.stats?.[key] ?? 0} />
        ))}
      </div>

      {/* Event queue */}
      {data.eventQueueSize > 0 && (
        <div className="bg-yellow-900/30 border border-yellow-800 rounded-lg px-4 py-3 text-sm text-yellow-300">
          {data.eventQueueSize} event{data.eventQueueSize > 1 ? "s" : ""} in queue
        </div>
      )}

      {/* Shift stats + health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ShiftStatsPanel shift={data.shift} />
        <ComponentHealth components={data.health?.components} />
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
