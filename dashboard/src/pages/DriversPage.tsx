import { useState } from "react";
import { useDrivers } from "../api/hooks";
import { StatusBadge } from "../components/StatusBadge";

const STATUS_COLORS: Record<string, string> = {
  Online: "border-emerald-700",
  Busy: "border-blue-700",
  Offline: "border-gray-700",
  OnBreak: "border-yellow-700",
  Inactive: "border-gray-800",
};

const STATUSES = ["All", "Online", "Busy", "Offline", "OnBreak"];

export function DriversPage() {
  const [statusFilter, setStatusFilter] = useState("All");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: drivers, isLoading } = useDrivers(
    statusFilter !== "All" ? { status: statusFilter } : undefined,
  );

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-white">Drivers</h2>

      <div className="flex gap-1 flex-wrap">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              statusFilter === s
                ? "bg-gray-700 text-white"
                : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-gray-500">Loading...</p>
      ) : !drivers?.length ? (
        <p className="text-gray-600">No drivers found.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {drivers.map((driver: any) => {
            const isExpanded = expanded === driver.driverId;
            const borderColor = STATUS_COLORS[driver.status] ?? "border-gray-700";
            return (
              <div
                key={driver.driverId}
                onClick={() => setExpanded(isExpanded ? null : driver.driverId)}
                className={`bg-gray-900 border ${borderColor} rounded-lg p-4 cursor-pointer hover:bg-gray-800/50 transition-colors`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-white font-medium text-sm">{driver.name}</p>
                    <p className="text-gray-500 font-mono text-xs mt-0.5">
                      {driver.monacher ?? driver.driverId?.split("@")[0]}
                    </p>
                  </div>
                  <StatusBadge value={driver.status} />
                </div>

                <div className="mt-3 flex items-center gap-4 text-xs text-gray-400">
                  <span>{driver.activeOrdersCount ?? 0} orders</span>
                  <span>{driver.dispatchZone ?? "-"}</span>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-gray-800 space-y-1 text-xs">
                    <DetailRow label="Phone" value={driver.phone} />
                    <DetailRow label="App" value={driver.appVersion} />
                    <DetailRow label="Device" value={driver.phoneModel} />
                    <DetailRow
                      label="Connected"
                      value={driver.connectionId ? "Yes" : "No"}
                    />
                    <DetailRow
                      label="Training"
                      value={driver.trainingOrders?.toString()}
                    />
                    {driver.deliveryArea && (
                      <DetailRow label="Area" value={driver.deliveryArea} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-gray-600">
        {drivers?.length ?? 0} driver{(drivers?.length ?? 0) !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-300">{value ?? "-"}</span>
    </div>
  );
}
