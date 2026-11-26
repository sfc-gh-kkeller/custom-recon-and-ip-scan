'use client';

import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { FlaggedTable } from './flagged-table';
import { Hero } from './hero';
import { BlockedList, ContainmentLog, FindingsFeed, MovementList, ScannerStatus, UserActivity } from './panels';
import { Section } from './section';
import type { BlocksData, ContainmentData, FindingsData, FlaggedData, MovementData, PulseData, StatusData } from './types';
import { useLive, useNow } from './use-live';
import { updatedAgo } from './time';

const WINDOWS = [
  { m: 15, label: '15 min' },
  { m: 30, label: '30 min' },
  { m: 60, label: '1 hour' },
  { m: 180, label: '3 hours' },
  { m: 720, label: '12 hours' },
];

export function Dashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = Number(params.get('window'));
  const win = WINDOWS.some((w) => w.m === requested) ? requested : 60;
  const windowLabel = WINDOWS.find((w) => w.m === win)?.label ?? '1 hour';
  const [live, setLive] = useState(true);
  const now = useNow();

  const pulse = useLive<PulseData>(`/api/pulse?window=${win}`, live, 15_000);
  const flagged = useLive<FlaggedData>('/api/flagged', live, 15_000);
  const findings = useLive<FindingsData>('/api/findings', live, 15_000);
  const blocks = useLive<BlocksData>(`/api/blocks?window=${win}`, live, 30_000);
  const movement = useLive<MovementData>('/api/movement-alerts', live, 120_000);
  const containment = useLive<ContainmentData>('/api/containment', live, 20_000);
  const status = useLive<StatusData>('/api/status', live, 60_000);

  const setWindow = (m: number) => {
    const next = new URLSearchParams(params.toString());
    next.set('window', String(m));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="mx-auto max-w-[88rem] px-4 pb-16 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b py-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl uppercase tracking-[0.12em]">Watchtower</h1>
          <p className="text-xs text-muted-foreground">Watched-user monitor · times in your local time zone</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Time window" className="flex overflow-hidden rounded-md border">
            {WINDOWS.map((w) => (
              <button
                key={w.m}
                type="button"
                aria-pressed={w.m === win}
                onClick={() => setWindow(w.m)}
                className={`px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${w.m === win ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
              >
                {w.label}
              </button>
            ))}
          </div>
          <Button variant={live ? 'secondary' : 'outline'} size="sm" aria-pressed={live} onClick={() => setLive((v) => !v)}>
            <span className={`mr-2 inline-block h-2 w-2 rounded-full ${live ? 'bg-primary' : 'bg-muted-foreground'}`} />
            {live ? 'Live' : 'Paused'}
            <span className="ml-2 hidden text-xs text-muted-foreground tnum sm:inline">{updatedAgo(pulse.data?.fetchedAt, now)}</span>
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <Hero
        pulse={pulse.data}
        pulseLoading={pulse.isPending}
        pulseError={pulse.error}
        flagged={flagged.data}
        watched={status.data?.population.watched}
        windowLabel={windowLabel}
      />

      <div className="mt-8 grid gap-x-10 gap-y-10 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Section
          title="Flagged users"
          note="from scanner findings, last 24 hours"
          fetchedAt={flagged.data?.fetchedAt}
          loading={flagged.isPending}
          error={flagged.error}
          empty={flagged.data?.users.length === 0}
          emptyText="No watched user has a finding in the last 24 hours."
        >
          {flagged.data ? <FlaggedTable users={flagged.data.users} /> : null}
        </Section>

        <Section
          title="Findings feed"
          note="newest first"
          fetchedAt={findings.data?.fetchedAt}
          loading={findings.isPending}
          error={findings.error}
          empty={findings.data?.findings.length === 0}
          emptyText="No findings in the last 24 hours."
        >
          {findings.data ? <FindingsFeed data={findings.data} /> : null}
        </Section>
      </div>

      <div className="mt-10 grid gap-x-10 gap-y-10 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Section
          title="Login activity by user"
          note={`last ${windowLabel}, live`}
          fetchedAt={pulse.data?.fetchedAt}
          loading={pulse.isPending}
          error={pulse.error}
          empty={pulse.data?.users.length === 0}
          emptyText={`No logins from watched users in the last ${windowLabel}.`}
        >
          {pulse.data ? <UserActivity data={pulse.data} /> : null}
        </Section>

        <div className="space-y-10">
          <Section
            title="Blocked data movement"
            note={`last ${Math.min(win, 180) === 180 ? '3 hours' : windowLabel}, live`}
            fetchedAt={blocks.data?.fetchedAt}
            loading={blocks.isPending}
            error={blocks.error}
            empty={blocks.data?.blocks.length === 0}
            emptyText="No blocked queries from watched users in this window."
          >
            {blocks.data ? <BlockedList data={blocks.data} /> : null}
          </Section>
          <Section
            title="Movement alerts, 24 hours"
            note="up to 3 hours behind"
            fetchedAt={movement.data?.fetchedAt}
            loading={movement.isPending}
            error={movement.error}
            empty={movement.data?.events.length === 0}
            emptyText="No data movement violations recorded yet."
          >
            {movement.data ? <MovementList data={movement.data} /> : null}
          </Section>
        </div>
      </div>

      <div className="mt-10 grid gap-x-10 gap-y-10 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Section
          title="Containment log"
          note="every action, including refusals"
          fetchedAt={containment.data?.fetchedAt}
          loading={containment.isPending}
          error={containment.error}
          empty={containment.data?.entries.length === 0}
          emptyText="No containment actions yet."
        >
          {containment.data ? <ContainmentLog data={containment.data} /> : null}
        </Section>
        <Section title="Scanner status" fetchedAt={status.data?.fetchedAt} loading={status.isPending} error={status.error}>
          {status.data ? <ScannerStatus data={status.data} /> : null}
        </Section>
      </div>
    </div>
  );
}
