import { useState, useEffect, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { useAuth } from "@/state/useAuth";
import {
  fetchBotAnalytics,
  type BotAnalyticsRecord,
} from "@/services/analytics";

/** Consistent colors for bot platforms */
const BOT_COLORS = [
  "hsl(141.9, 69.8%, 45.5%)", // primary green
  "hsl(220, 60%, 55%)", // blue
  "hsl(30, 80%, 55%)", // orange
  "hsl(280, 55%, 55%)", // purple
  "hsl(0, 70%, 55%)", // red
  "hsl(180, 55%, 45%)", // teal
  "hsl(60, 65%, 45%)", // olive
  "hsl(330, 60%, 55%)", // pink
];

function getBotColor(index: number): string {
  return BOT_COLORS[index % BOT_COLORS.length];
}

/** Aggregate total visits per bot platform */
function aggregateByBot(
  records: BotAnalyticsRecord[]
): { bot: string; visits: number }[] {
  const map = new Map<string, number>();
  for (const r of records) {
    map.set(r.bot, (map.get(r.bot) ?? 0) + r.visitCount);
  }
  return Array.from(map.entries())
    .map(([bot, visits]) => ({ bot, visits }))
    .sort((a, b) => b.visits - a.visits);
}

/** Build time-series data: one row per date, one key per bot */
function aggregateByDate(
  records: BotAnalyticsRecord[]
): { data: Record<string, unknown>[]; bots: string[] } {
  const botsSet = new Set<string>();
  const dateMap = new Map<string, Map<string, number>>();

  for (const r of records) {
    botsSet.add(r.bot);
    if (!dateMap.has(r.date)) {
      dateMap.set(r.date, new Map());
    }
    const botMap = dateMap.get(r.date)!;
    botMap.set(r.bot, (botMap.get(r.bot) ?? 0) + r.visitCount);
  }

  const bots = Array.from(botsSet).sort();
  const dates = Array.from(dateMap.keys()).sort();

  const data = dates.map((date) => {
    const row: Record<string, unknown> = { date };
    const botMap = dateMap.get(date)!;
    for (const bot of bots) {
      row[bot] = botMap.get(bot) ?? 0;
    }
    return row;
  });

  return { data, bots };
}

export function AnalyticsPage(): JSX.Element {
  const npub = useAuth((state) => state.npub);
  const [records, setRecords] = useState<BotAnalyticsRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!npub) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const items = await fetchBotAnalytics(npub);
        if (!cancelled) {
          setRecords(items);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load analytics"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [npub]);

  const byBot = useMemo(() => aggregateByBot(records), [records]);
  const { data: timeSeriesData, bots } = useMemo(
    () => aggregateByDate(records),
    [records]
  );

  if (loading) {
    return (
      <div className="container flex min-h-[400px] items-center justify-center py-10">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            Loading analytics...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-10">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">
            Bot Analytics
          </h1>
          <p className="text-muted-foreground">
            See which AI bots are visiting your discovery page.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {!error && records.length === 0 && (
          <div className="rounded-lg border bg-card p-8 text-center shadow-sm">
            <p className="text-muted-foreground">
              No bot visits recorded yet. Once AI bots crawl your discovery
              page, their visits will appear here.
            </p>
          </div>
        )}

        {records.length > 0 && (
          <>
            {/* Section A: Total Visits by Bot */}
            <section className="rounded-lg border bg-card p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">
                Total Visits by Bot
              </h2>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={byBot}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="bot" width={70} />
                    <Tooltip />
                    <Bar
                      dataKey="visits"
                      fill="hsl(141.9, 69.8%, 45.5%)"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* Section B: Visits Over Time */}
            <section className="rounded-lg border bg-card p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">
                Visits Over Time
              </h2>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={timeSeriesData}
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    {bots.map((bot, i) => (
                      <Line
                        key={bot}
                        type="monotone"
                        dataKey={bot}
                        stroke={getBotColor(i)}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
