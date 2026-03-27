import { NavLink, Outlet } from "react-router";
import { useOverview } from "../api/hooks";

const NAV_ITEMS = [
  { to: "/overview", label: "Overview" },
  { to: "/orders", label: "Orders" },
  { to: "/drivers", label: "Drivers" },
  { to: "/restaurants", label: "Restaurants" },
  { to: "/markets", label: "Markets" },
  { to: "/tickets", label: "Tickets" },
  { to: "/events", label: "Event Feed" },
  { to: "/audit", label: "Audit Log" },
];

function SyncIndicator() {
  const { data } = useOverview();
  if (!data?.stats?.lastSyncedAt) {
    return <span className="inline-block w-2 h-2 rounded-full bg-gray-600" />;
  }
  const age = (Date.now() - new Date(data.stats.lastSyncedAt).getTime()) / 1000;
  const color = age < 30 ? "bg-emerald-400" : age < 60 ? "bg-yellow-400" : "bg-red-400";
  return (
    <span className="flex items-center gap-1.5 text-xs text-gray-400">
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
      {Math.round(age)}s ago
    </span>
  );
}

function HealthBadge() {
  const { data } = useOverview();
  const status = data?.health?.status ?? "unknown";
  const color =
    status === "healthy"
      ? "bg-emerald-900 text-emerald-300"
      : status === "degraded"
        ? "bg-yellow-900 text-yellow-300"
        : "bg-red-900 text-red-300";
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {status}
    </span>
  );
}

export function Layout() {
  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-4 py-4 border-b border-gray-800">
          <h1 className="text-lg font-bold text-white tracking-tight">
            Sisyphus
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">Ontology Dashboard</p>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          <NavLink
            to="/live"
            className="block px-3 py-2 rounded-md text-sm font-medium text-indigo-400 hover:text-indigo-300 hover:bg-indigo-900/30 transition-colors mb-2 border border-indigo-800/50"
          >
            Live Map
          </NavLink>
          {NAV_ITEMS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-gray-800 text-white font-medium"
                    : "text-gray-400 hover:text-white hover:bg-gray-800/50"
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-3 border-t border-gray-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Health</span>
            <HealthBadge />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Sync</span>
            <SyncIndicator />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-gray-950 p-6">
        <Outlet />
      </main>
    </div>
  );
}
