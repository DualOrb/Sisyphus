import { useState } from "react";
import { useOrders } from "../api/hooks";
import { StatusBadge } from "../components/StatusBadge";

const STATUSES = ["All", "Pending", "Confirmed", "Ready", "EnRoute", "InTransit", "Completed", "Cancelled"];

function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "-";
  return `$${(cents / 100).toFixed(2)}`;
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const ms = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "<1m";
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export function OrdersPage() {
  const [statusFilter, setStatusFilter] = useState("All");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: orders, isLoading } = useOrders(
    statusFilter !== "All" ? { status: statusFilter } : undefined,
  );

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-white">Orders</h2>

      {/* Status filter tabs */}
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
      ) : !orders?.length ? (
        <p className="text-gray-600">No orders found.</p>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left">
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Order</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Restaurant</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Zone</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Status</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Driver</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Wait</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Total</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Placed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {orders.map((order: any) => (
                <tr
                  key={order.orderId}
                  onClick={() => setExpanded(expanded === order.orderId ? null : order.orderId)}
                  className={`cursor-pointer transition-colors hover:bg-gray-800/50 ${
                    order.isLate ? "bg-red-950/30" : ""
                  }`}
                >
                  <td className="px-4 py-3 text-white font-mono text-xs">
                    {order.orderIdKey ?? order.orderId?.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 text-gray-300">{order.restaurantName ?? "-"}</td>
                  <td className="px-4 py-3 text-gray-400">{order.deliveryZone ?? "-"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge value={order.status} />
                    {order.isLate && (
                      <span className="ml-1.5 text-xs text-red-400 font-medium">LATE</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-300 font-mono text-xs">
                    {order.driverMonacher ?? order.driverId?.split("@")[0] ?? (
                      <span className="text-yellow-500">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">
                    {order.waitTimeMinutes != null ? `${order.waitTimeMinutes}m` : "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-300 font-mono text-xs">
                    {formatCents(order.total)}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {order.placedAt ? timeAgo(order.placedAt) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-600">
            {orders.length} order{orders.length !== 1 ? "s" : ""}
          </div>
        </div>
      )}
    </div>
  );
}
