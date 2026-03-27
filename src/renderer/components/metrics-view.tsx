import { Spinner } from "@/components/ui/spinner";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Clock, GitMerge } from "lucide-react";
import { useMemo, useState } from "react";

import { ipc } from "../lib/ipc";
import { useWorkspace } from "../lib/workspace-context";
import { GitHubAvatar } from "./github-avatar";

/**
 * Team metrics dashboard — Phase 3 §3.2
 *
 * PR cycle time, review load, size distribution.
 * All data computed locally from gh CLI.
 */

type TimeRange = "7d" | "30d" | "90d";

function getSinceDate(range: TimeRange): string {
  const now = new Date();
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  now.setDate(now.getDate() - days);
  return now.toISOString().slice(0, 10);
}

export function MetricsView() {
  const { cwd } = useWorkspace();
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const since = getSinceDate(timeRange);

  const cycleTimeQuery = useQuery({
    queryKey: ["metrics", "prCycleTime", cwd, since],
    queryFn: () => ipc("metrics.prCycleTime", { cwd, since }),
    staleTime: 300_000,
  });

  const reviewLoadQuery = useQuery({
    queryKey: ["metrics", "reviewLoad", cwd, since],
    queryFn: () => ipc("metrics.reviewLoad", { cwd, since }),
    staleTime: 300_000,
  });

  const cycleData = cycleTimeQuery.data ?? [];
  const reviewData = reviewLoadQuery.data ?? [];

  // Summary stats
  const stats = useMemo(() => {
    const merged = cycleData.filter((p) => p.mergedAt);
    const avgCycleTime =
      merged.length > 0
        ? merged.reduce((sum, p) => sum + (p.timeToMerge ?? 0), 0) / merged.length
        : 0;
    const avgReviewTime = cycleData.some((p) => p.timeToFirstReview)
      ? cycleData
          .filter((p) => p.timeToFirstReview)
          .reduce((sum, p) => sum + (p.timeToFirstReview ?? 0), 0) /
        cycleData.filter((p) => p.timeToFirstReview).length
      : 0;
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
    const throughput = merged.length / (days / 7);

    return { avgCycleTime, avgReviewTime, throughput, mergedCount: merged.length };
  }, [cycleData, timeRange]);

  // Size distribution
  const sizeDistribution = useMemo(() => {
    const sizes = { S: 0, M: 0, L: 0, XL: 0 };
    for (const pr of cycleData) {
      const total = pr.additions + pr.deletions;
      if (total < 50) {
        sizes.S++;
      } else if (total < 200) {
        sizes.M++;
      } else if (total < 500) {
        sizes.L++;
      } else {
        sizes.XL++;
      }
    }
    return sizes;
  }, [cycleData]);

  // PR count per author
  const prCountData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pr of cycleData) {
      counts.set(pr.author, (counts.get(pr.author) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([author, prCount]) => ({ author, prCount }))
      .toSorted((a, b) => b.prCount - a.prCount);
  }, [cycleData]);

  const [graphMode, setGraphMode] = useState<"reviews" | "prs">("reviews");

  const isLoading = cycleTimeQuery.isLoading || reviewLoadQuery.isLoading;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-heading text-text-primary text-2xl italic">Metrics</h1>
            <p className="text-text-secondary mt-1 text-sm">PR velocity and review health.</p>
          </div>
          {/* Time range selector */}
          <div className="border-border bg-bg-raised flex rounded-md border p-[2px]">
            {(["7d", "30d", "90d"] as const).map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setTimeRange(range)}
                className={`cursor-pointer rounded-sm px-3 py-1 text-[11px] ${
                  timeRange === range
                    ? "bg-bg-elevated text-text-primary shadow-sm"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner className="text-primary h-5 w-5" />
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="mt-6 grid grid-cols-3 gap-3">
              <SummaryCard
                label="Avg cycle time"
                value={formatMinutes(stats.avgCycleTime)}
                icon={
                  <Clock
                    size={14}
                    className="text-primary"
                  />
                }
              />
              <SummaryCard
                label="Avg time to review"
                value={formatMinutes(stats.avgReviewTime)}
                icon={
                  <BarChart3
                    size={14}
                    className="text-info"
                  />
                }
              />
              <SummaryCard
                label="Throughput / week"
                value={stats.throughput.toFixed(1)}
                icon={
                  <GitMerge
                    size={14}
                    className="text-success"
                  />
                }
                sub={`${stats.mergedCount} merged`}
              />
            </div>

            {/* Review load / PR count */}
            {(reviewData.length > 0 || prCountData.length > 0) && (
              <section className="mt-8">
                <div className="mb-3 flex items-center gap-3">
                  <h2 className="text-text-tertiary text-[10px] font-bold tracking-[0.06em] uppercase">
                    {graphMode === "reviews" ? "Review load" : "PR count"}
                  </h2>
                  <div className="border-border bg-bg-raised flex rounded-md border p-[2px]">
                    <button
                      type="button"
                      onClick={() => setGraphMode("reviews")}
                      className={`cursor-pointer rounded-sm px-2 py-0.5 text-[10px] ${
                        graphMode === "reviews"
                          ? "bg-bg-elevated text-text-primary shadow-sm"
                          : "text-text-tertiary hover:text-text-secondary"
                      }`}
                    >
                      Reviews
                    </button>
                    <button
                      type="button"
                      onClick={() => setGraphMode("prs")}
                      className={`cursor-pointer rounded-sm px-2 py-0.5 text-[10px] ${
                        graphMode === "prs"
                          ? "bg-bg-elevated text-text-primary shadow-sm"
                          : "text-text-tertiary hover:text-text-secondary"
                      }`}
                    >
                      PRs
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  {graphMode === "reviews"
                    ? reviewData.map((r) => {
                        const maxCount = reviewData[0]?.reviewCount ?? 1;
                        return (
                          <div
                            key={r.reviewer}
                            className="flex items-center gap-3"
                          >
                            <GitHubAvatar
                              login={r.reviewer}
                              size={20}
                            />
                            <span className="text-text-primary w-24 truncate text-xs font-medium">
                              {r.reviewer}
                            </span>
                            <div className="bg-bg-raised relative h-4 flex-1 overflow-hidden rounded-sm">
                              <div
                                className="bg-primary/50 h-full rounded-sm"
                                style={{ width: `${(r.reviewCount / maxCount) * 100}%` }}
                              />
                            </div>
                            <span className="text-text-tertiary w-20 text-right font-mono text-[10px]">
                              {r.reviewCount} reviews
                            </span>
                          </div>
                        );
                      })
                    : prCountData.map((r) => {
                        const maxCount = prCountData[0]?.prCount ?? 1;
                        return (
                          <div
                            key={r.author}
                            className="flex items-center gap-3"
                          >
                            <GitHubAvatar
                              login={r.author}
                              size={20}
                            />
                            <span className="text-text-primary w-24 truncate text-xs font-medium">
                              {r.author}
                            </span>
                            <div className="bg-bg-raised relative h-4 flex-1 overflow-hidden rounded-sm">
                              <div
                                className="bg-success/50 h-full rounded-sm"
                                style={{ width: `${(r.prCount / maxCount) * 100}%` }}
                              />
                            </div>
                            <span className="text-text-tertiary w-20 text-right font-mono text-[10px]">
                              {r.prCount} PRs
                            </span>
                          </div>
                        );
                      })}
                </div>
              </section>
            )}

            {/* PR size distribution */}
            <section className="mt-8">
              <h2 className="text-text-tertiary mb-3 text-[10px] font-bold tracking-[0.06em] uppercase">
                PR size distribution
              </h2>
              <div className="flex flex-col gap-1.5">
                {(Object.entries(sizeDistribution) as Array<[string, number]>).map(
                  ([size, count]) => {
                    const maxCount = Math.max(...Object.values(sizeDistribution), 1);
                    const colors: Record<string, string> = {
                      S: "bg-success/50",
                      M: "bg-warning/50",
                      L: "bg-info/50",
                      XL: "bg-destructive/50",
                    };
                    return (
                      <div
                        key={size}
                        className="flex items-center gap-2"
                      >
                        <span className="text-text-secondary w-6 text-right font-mono text-xs font-medium">
                          {size}
                        </span>
                        <div className="bg-bg-raised relative h-5 flex-1 overflow-hidden rounded-sm">
                          <div
                            className={`h-full rounded-sm ${colors[size] ?? "bg-primary/50"}`}
                            style={{ width: `${(count / maxCount) * 100}%` }}
                          />
                        </div>
                        <span className="text-text-tertiary w-8 font-mono text-[10px]">
                          {count}
                        </span>
                      </div>
                    );
                  },
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  sub,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="border-border bg-bg-raised rounded-lg border p-4">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-text-tertiary text-[10px] font-semibold tracking-[0.06em] uppercase">
          {label}
        </span>
      </div>
      <p className="text-text-primary mt-2 font-mono text-xl font-semibold">{value}</p>
      {sub && <p className="text-text-ghost mt-0.5 text-[10px]">{sub}</p>}
    </div>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }
  const hours = minutes / 60;
  if (hours < 24) {
    return `${hours.toFixed(1)}h`;
  }
  return `${(hours / 24).toFixed(1)}d`;
}
