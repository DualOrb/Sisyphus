import { useMarkets } from "../api/hooks";
import { StatusBadge } from "../components/StatusBadge";

function ScoreGauge({ score }: { score: number }) {
  const color = score <= 40 ? "bg-emerald-500" : score <= 70 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-sm text-gray-300 font-mono w-8">{score}</span>
    </div>
  );
}

export function MarketsPage() {
  const { data: markets, isLoading } = useMarkets();

  if (isLoading) return <p className="text-gray-500">Loading...</p>;
  if (!markets?.length) return <p className="text-gray-600">No markets found.</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-white">Markets</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {markets.map((m: any) => (
          <div
            key={m.market}
            className="bg-gray-900 border border-gray-800 rounded-lg p-5"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-white font-semibold">{m.market}</h3>
                {m.demandLevel && (
                  <StatusBadge value={m.demandLevel} />
                )}
              </div>
              <ScoreGauge score={m.score ?? 0} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Stat label="Available" value={m.availableDrivers ?? 0} />
              <Stat label="Ideal" value={m.idealDrivers ?? 0} />
              <Stat
                label="Gap"
                value={m.driverGap ?? 0}
                warn={m.driverGap > 0}
              />
              <Stat label="Active Orders" value={m.activeOrders ?? 0} />
              <Stat
                label="Ratio"
                value={m.driverToOrderRatio != null ? m.driverToOrderRatio.toFixed(1) : "-"}
              />
              <Stat
                label="ETA"
                value={m.eta != null ? `${m.eta}m` : "-"}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string | number;
  warn?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-sm font-mono ${warn ? "text-red-400" : "text-white"}`}>
        {value}
      </p>
    </div>
  );
}
