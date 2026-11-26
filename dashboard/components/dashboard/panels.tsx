'use client';

import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SeverityDot } from './section';
import { ago, fmtDayTime } from './time';
import type { BlocksData, ContainmentData, FindingsData, MovementData, PulseData, StatusData } from './types';
import { useNow } from './use-live';

export function FindingsFeed({ data }: { data: FindingsData }) {
  const now = useNow();
  return (
    <ol className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
      {data.findings.map((f) => (
        <li key={f.id} className="min-w-0 border-l-2 pl-3" style={{ borderColor: f.severity === 'HIGH' ? 'var(--destructive)' : 'var(--warning)' }}>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <SeverityDot severity={f.severity} />
            <span className="font-mono">{f.scanner.replace(/^RT_/, '')}</span>
            <span className="tnum">{ago(f.at, now)}</span>
          </p>
          <p className="break-words text-sm">
            <span className="font-mono">{f.user}</span> · {f.summary}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function UserActivity({ data }: { data: PulseData }) {
  const now = useNow();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead numeric>Attempts</TableHead>
          <TableHead numeric>Failed</TableHead>
          <TableHead numeric>IPs</TableHead>
          <TableHead className="hidden md:table-cell">Clients</TableHead>
          <TableHead className="hidden sm:table-cell">Last</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.users.map((u) => (
          <TableRow key={u.user}>
            <TableCell className="max-w-40 truncate font-mono text-sm">{u.user}</TableCell>
            <TableCell numeric>{u.attempts}</TableCell>
            <TableCell numeric className={u.failed > 0 ? 'text-destructive' : ''}>{u.failed}</TableCell>
            <TableCell numeric>{u.ips}</TableCell>
            <TableCell className="hidden max-w-48 truncate font-mono text-xs text-muted-foreground md:table-cell">{u.clients}</TableCell>
            <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground sm:table-cell">{ago(u.last, now)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function BlockedList({ data }: { data: BlocksData }) {
  return (
    <ul className="max-h-72 space-y-3 overflow-y-auto pr-1">
      {data.blocks.map((b) => (
        <li key={b.queryId} className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <Badge variant="destructive">blocked</Badge>
            <span className="font-mono">{b.user}</span>
            <span className="tnum">{fmtDayTime(b.at)}</span>
          </div>
          <p className="mt-1 truncate font-mono text-xs" title={b.text}>{b.text}</p>
        </li>
      ))}
    </ul>
  );
}

export function MovementList({ data }: { data: MovementData }) {
  return (
    <ul className="max-h-72 space-y-3 overflow-y-auto pr-1">
      {data.events.map((e) => (
        <li key={e.queryId} className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <Badge variant={e.outcome === 'blocked' ? 'destructive' : 'warning'}>{e.outcome}</Badge>
            <span className="font-mono">{e.user}</span>
            <span>{e.movement.toLowerCase().replace(/_/g, ' ')}</span>
            <span className="tnum">{fmtDayTime(e.at)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ContainmentLog({ data }: { data: ContainmentData }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>User</TableHead>
          <TableHead>Action</TableHead>
          <TableHead className="hidden sm:table-cell">By</TableHead>
          <TableHead>Result</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.entries.map((e, i) => (
          <TableRow key={`${e.at}-${i}`}>
            <TableCell className="whitespace-nowrap text-xs tnum">{fmtDayTime(e.at)}</TableCell>
            <TableCell className="max-w-32 truncate font-mono text-sm">{e.user}</TableCell>
            <TableCell className="whitespace-nowrap text-xs">{e.action.toLowerCase().replace(/_/g, ' ')}</TableCell>
            <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{e.by}</TableCell>
            <TableCell className={`max-w-56 break-words text-xs ${e.result.startsWith('OK') ? 'text-primary' : 'text-warning'}`}>{e.result}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ScannerStatus({ data }: { data: StatusData }) {
  const t = data.thresholds;
  return (
    <div className="space-y-4">
      <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {data.jobs.map((j) => (
          <li key={`${j.kind}-${j.name}`} className="flex min-w-0 items-center gap-2 text-sm">
            <span
              aria-label={j.state}
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${j.state === 'started' ? 'bg-primary' : 'bg-muted-foreground/50'}`}
            />
            <span className="truncate font-mono text-xs">{j.name}</span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{j.state === 'started' ? j.schedule || 'running' : 'suspended'}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {data.population.watched} watched · {data.population.protected} protected · thresholds: burst {t.loginBurst} attempts, {t.sameIp} per IP,
        {' '}{t.failedLogins} failed, {t.ipDistinct} IPs, window {t.windowMinutes} min
      </p>
    </div>
  );
}
