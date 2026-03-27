import { useState } from "react";
import { useAudit } from "../api/hooks";
import { StatusBadge } from "../components/StatusBadge";

export function AuditPage() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [outcomeFilter, setOutcomeFilter] = useState("All");

  const { data: records, isLoading } = useAudit(200);

  const filtered =
    outcomeFilter === "All"
      ? records
      : records?.filter((r: any) => r.outcome === outcomeFilter);

  const outcomes = ["All", "executed", "staged", "rejected", "cooldown_blocked", "rate_limited"];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-white">Audit Log</h2>

      <div className="flex gap-1 flex-wrap">
        {outcomes.map((o) => (
          <button
            key={o}
            onClick={() => setOutcomeFilter(o)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              outcomeFilter === o
                ? "bg-gray-700 text-white"
                : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
            }`}
          >
            {o}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-gray-500">Loading...</p>
      ) : !filtered?.length ? (
        <p className="text-gray-600">No audit records found.</p>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left">
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Time</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Action</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Agent</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Entity</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Outcome</th>
                <th className="px-4 py-3 text-xs text-gray-500 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered!.map((r: any) => {
                const isExpanded = expanded === r.id;
                return (
                  <tr
                    key={r.id}
                    onClick={() => setExpanded(isExpanded ? null : r.id)}
                    className="cursor-pointer hover:bg-gray-800/50 align-top"
                  >
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">
                      {r.timestamp
                        ? new Date(r.timestamp).toLocaleTimeString()
                        : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-white text-xs font-medium">
                        {r.actionType ?? r.action_type}
                      </span>
                      {isExpanded && r.reasoning && (
                        <p className="text-xs text-gray-500 mt-2 max-w-md">
                          {r.reasoning}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {(r.agentId ?? r.agent_id)?.replace("_agent", "") ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs font-mono">
                      {r.entityId ?? r.entity_id ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge value={r.outcome ?? "-"} />
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">
                      {(r.executionTimeMs ?? r.execution_time_ms) != null
                        ? `${r.executionTimeMs ?? r.execution_time_ms}ms`
                        : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-600">
            {filtered!.length} record{filtered!.length !== 1 ? "s" : ""}
          </div>
        </div>
      )}
    </div>
  );
}
