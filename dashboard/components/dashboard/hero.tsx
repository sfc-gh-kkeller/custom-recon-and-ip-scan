'use client';

import { CHART_COLORS, ChartTooltip, formatTick } from '@/components/chart-utils';
import { CountUp } from '@/components/count-up';
import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtHm } from './time';
import type { FlaggedData, PulseData } from './types';

/** Zero-fills empty buckets so quiet minutes show as gaps instead of disappearing from the axis. */
function buildSeries(pulse: PulseData) {
  const step = pulse.bucketMinutes * 60;
  const end = Math.floor(pulse.fetchedAt / 1000 / step) * step;
  const start = end - Math.floor((pulse.window * 60) / step) * step;
  const byT = new Map(pulse.series.map((p) => [p.t, p]));
  const out: { t: number; label: string; ok: number; failed: number }[] = [];
  for (let t = start; t <= end; t += step) {
    const p = byT.get(t);
    out.push({ t, label: fmtHm(t), ok: p?.ok ?? 0, failed: p?.failed ?? 0 });
  }
  return out;
}

export function Hero({
  pulse,
  pulseLoading,
  pulseError,
  flagged,
  watched,
  windowLabel,
}: {
  pulse?: PulseData;
  pulseLoading: boolean;
  pulseError: Error | null;
  flagged?: FlaggedData;
  watched?: number;
  windowLabel: string;
}) {
  const data = useMemo(() => (pulse ? buildSeries(pulse) : []), [pulse]);
  const count = flagged?.users.length ?? 0;
  const high = flagged?.users.filter((u) => u.high).length ?? 0;
  const tone = flagged === undefined ? 'text-muted-foreground' : count === 0 ? 'text-primary' : high > 0 ? 'text-destructive' : 'text-warning';
  const state = flagged === undefined ? 'Checking' : count === 0 ? 'All quiet' : high > 0 ? 'Needs attention' : 'Watch closely';
  const failedShare = pulse && pulse.totals.attempts > 0 ? Math.round((pulse.totals.failed / pulse.totals.attempts) * 100) : 0;

  return (
    <div className="radar-grid grid gap-x-10 gap-y-6 border-b py-8 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
      <div className="min-w-0 animate-rise">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Flagged in the last 24 hours</p>
        <div className={`font-display leading-[0.85] tnum ${tone} text-[8.5rem] sm:text-[10rem]`} aria-live="polite">
          {flagged === undefined ? '–' : <CountUp value={count} format={(n) => String(Math.round(n))} />}
        </div>
        <p className={`font-display text-2xl uppercase tracking-wide ${tone}`}>{state}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {high > 0 ? `${high} high severity · ` : ''}
          {watched !== undefined ? `${watched} ${watched === 1 ? 'user' : 'users'} on the watchlist` : 'watchlist loading'}
        </p>
      </div>

      <div className="min-w-0 animate-rise" style={{ animationDelay: '120ms' }}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Watched-user logins · last {windowLabel} · {pulse?.bucketMinutes ?? 1} min buckets
          </p>
          <p className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: CHART_COLORS[0] }} /> succeeded</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: CHART_COLORS[2] }} /> failed</span>
          </p>
        </div>

        <div className="relative mt-2 h-56 min-w-0" role="img" aria-label={`Logins per ${pulse?.bucketMinutes ?? 1} minute for watched users, ${pulse?.totals.attempts ?? 0} attempts, ${pulse?.totals.failed ?? 0} failed in the last ${windowLabel}`}>
          {pulseError ? (
            <p role="alert" className="text-sm text-destructive">{pulseError.message}</p>
          ) : pulseLoading || !pulse ? (
            <div className="h-full animate-pulse rounded bg-muted" aria-busy="true" />
          ) : (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap={1}>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: 'var(--chart-axis)', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={48} />
                  <YAxis allowDecimals={false} width={34} tick={{ fill: 'var(--chart-axis)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={formatTick} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--accent)' }} />
                  <Bar dataKey="ok" name="Succeeded" stackId="a" fill={CHART_COLORS[0]} isAnimationActive={false} />
                  <Bar dataKey="failed" name="Failed" stackId="a" fill={CHART_COLORS[2]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
              <span className="pointer-events-none absolute right-2 top-1 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-primary" aria-hidden="true">
                now
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping-now rounded-full bg-primary" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                </span>
              </span>
            </>
          )}
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          {[
            ['Attempts', pulse ? String(pulse.totals.attempts) : '–'],
            ['Failed', pulse ? `${pulse.totals.failed}${pulse.totals.attempts ? ` (${failedShare}%)` : ''}` : '–'],
            ['Distinct IPs', pulse ? String(pulse.totals.ips) : '–'],
            ['Active users', pulse ? String(pulse.totals.users) : '–'],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{k}</dt>
              <dd className="font-display text-2xl tnum">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
