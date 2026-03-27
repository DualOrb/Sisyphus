import { useState } from "react";
import { useRestaurants } from "../api/hooks";
import { StatusBadge } from "../components/StatusBadge";

function HealthBar({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-gray-600">-</span>;
  const color = score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs text-gray-400 font-mono">{score}</span>
    </div>
  );
}

export function RestaurantsPage() {
  const [openFilter, setOpenFilter] = useState<string>("all");
  const { data: restaurants, isLoading } = useRestaurants(
    openFilter !== "all" ? { open: openFilter } : undefined,
  );

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-white">Restaurants</h2>

      <div className="flex gap-1">
        {[
          ["all", "All"],
          ["true", "Open"],
          ["false", "Closed"],
        ].map(([val, label]) => (
          <button
            key={val}
            onClick={() => setOpenFilter(val)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              openFilter === val
                ? "bg-gray-700 text-white"
                : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-gray-500">Loading...</p>
      ) : !restaurants?.length ? (
        <p className="text-gray-600">No restaurants found.</p>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left">
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Name</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Zone</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Status</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Tablet</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Health</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Load</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">POS ETA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {restaurants.map((r: any) => (
                <tr key={r.restaurantId} className="hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-white">{r.name}</td>
                  <td className="px-4 py-3 text-gray-400">{r.deliveryZone ?? "-"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-medium ${r.isOpen ? "text-emerald-400" : "text-gray-500"}`}
                    >
                      {r.isOpen ? "Open" : "Closed"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-medium ${
                        r.isTabletOnline ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {r.isTabletOnline ? "Online" : "Offline"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <HealthBar score={r.healthScore} />
                  </td>
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">
                    {r.currentLoad ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">
                    {r.posEta != null ? `${r.posEta}m` : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-600">
            {restaurants.length} restaurant{restaurants.length !== 1 ? "s" : ""}
          </div>
        </div>
      )}
    </div>
  );
}
