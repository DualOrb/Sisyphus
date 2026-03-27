import { useState } from "react";
import { useTickets } from "../api/hooks";
import { StatusBadge } from "../components/StatusBadge";

const STATUSES = ["All", "New", "Pending", "Resolved", "Closed"];

export function TicketsPage() {
  const [statusFilter, setStatusFilter] = useState("All");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: tickets, isLoading } = useTickets(
    statusFilter !== "All" ? { status: statusFilter } : undefined,
  );

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-white">Tickets</h2>

      <div className="flex gap-1">
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
      ) : !tickets?.length ? (
        <p className="text-gray-600">No tickets found.</p>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left">
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">ID</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Category</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Type</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Status</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Market</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Owner</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {tickets.map((t: any) => {
                const isExpanded = expanded === t.issueId;
                return (
                  <tr
                    key={t.issueId}
                    onClick={() => setExpanded(isExpanded ? null : t.issueId)}
                    className="cursor-pointer hover:bg-gray-800/50"
                  >
                    <td className="px-4 py-3 text-white font-mono text-xs">{t.issueId}</td>
                    <td className="px-4 py-3 text-gray-300">{t.category ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{t.issueType ?? "-"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge value={t.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-400">{t.market ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {t.owner === "Unassigned" ? (
                        <span className="text-yellow-500">Unassigned</span>
                      ) : (
                        t.owner?.split("@")[0] ?? "-"
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {t.createdAt ? new Date(t.createdAt).toLocaleTimeString() : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-600">
            {tickets.length} ticket{tickets.length !== 1 ? "s" : ""}
          </div>
        </div>
      )}
    </div>
  );
}
