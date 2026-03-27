const COLOR_MAP: Record<string, string> = {
  // Order statuses
  Pending: "bg-yellow-900 text-yellow-300",
  Confirmed: "bg-blue-900 text-blue-300",
  Ready: "bg-cyan-900 text-cyan-300",
  EnRoute: "bg-indigo-900 text-indigo-300",
  InTransit: "bg-purple-900 text-purple-300",
  Completed: "bg-emerald-900 text-emerald-300",
  Cancelled: "bg-red-900 text-red-300",

  // Driver statuses
  Online: "bg-emerald-900 text-emerald-300",
  Busy: "bg-blue-900 text-blue-300",
  Offline: "bg-gray-800 text-gray-400",
  OnBreak: "bg-yellow-900 text-yellow-300",
  Inactive: "bg-gray-800 text-gray-500",

  // Ticket statuses
  New: "bg-orange-900 text-orange-300",
  Resolved: "bg-emerald-900 text-emerald-300",
  Closed: "bg-gray-800 text-gray-400",

  // Demand levels
  Low: "bg-emerald-900 text-emerald-300",
  Normal: "bg-blue-900 text-blue-300",
  High: "bg-orange-900 text-orange-300",
  Surge: "bg-red-900 text-red-300",

  // Audit outcomes
  executed: "bg-emerald-900 text-emerald-300",
  staged: "bg-yellow-900 text-yellow-300",
  rejected: "bg-red-900 text-red-300",
  cooldown_blocked: "bg-gray-800 text-gray-400",
  rate_limited: "bg-orange-900 text-orange-300",
  circuit_broken: "bg-red-900 text-red-300",

  // Event priorities
  critical: "bg-red-900 text-red-300",
  high: "bg-orange-900 text-orange-300",
  normal: "bg-blue-900 text-blue-300",
  low: "bg-gray-800 text-gray-400",

  // Health
  healthy: "bg-emerald-900 text-emerald-300",
  degraded: "bg-yellow-900 text-yellow-300",
  unhealthy: "bg-red-900 text-red-300",
};

export function StatusBadge({ value }: { value: string }) {
  const color = COLOR_MAP[value] ?? "bg-gray-800 text-gray-300";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {value}
    </span>
  );
}
