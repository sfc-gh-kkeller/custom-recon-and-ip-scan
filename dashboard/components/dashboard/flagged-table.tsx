'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SeverityDot } from './section';
import { ago } from './time';
import type { FlaggedUser } from './types';
import { useNow } from './use-live';

type Action = 'ABORT_QUERIES' | 'DISABLE_USER' | 'ENABLE_USER';
const LABEL: Record<Action, string> = {
  ABORT_QUERIES: 'Abort queries',
  DISABLE_USER: 'Disable',
  ENABLE_USER: 'Enable',
};

async function contain(vars: { user: string; action: Action; confirmed: boolean }) {
  const r = await fetch('/api/contain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(vars),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? 'The action failed');
  return body as { ok: boolean; result: string };
}

export function FlaggedTable({ users }: { users: FlaggedUser[] }) {
  const now = useNow();
  const qc = useQueryClient();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [typed, setTyped] = useState('');

  const mutation = useMutation({
    mutationFn: contain,
    onSuccess: (r) => {
      setMessage({ ok: r.ok, text: r.result });
      qc.invalidateQueries({ queryKey: ['live'] });
    },
    onError: (e: Error) => setMessage({ ok: false, text: e.message }),
  });

  const run = (user: string, action: Action, confirmed = false) => {
    setMessage(null);
    mutation.mutate({ user, action, confirmed });
  };

  return (
    <>
      <p aria-live="polite" role="status" className={`min-h-5 text-sm ${message ? (message.ok ? 'text-primary' : 'text-destructive') : ''}`}>
        {message?.text}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead className="hidden md:table-cell">Scanners</TableHead>
            <TableHead numeric>Findings</TableHead>
            <TableHead className="hidden sm:table-cell">Last seen</TableHead>
            <TableHead>Containment</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.user}>
              <TableCell className="min-w-0">
                <span className="flex items-center gap-2">
                  <SeverityDot severity={u.high ? 'HIGH' : 'MEDIUM'} />
                  <span className="truncate font-mono text-sm">{u.user}</span>
                </span>
                {u.lastAction ? (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    last: {LABEL[u.lastAction as Action] ?? u.lastAction}
                    {u.lastActionAt ? ` ${ago(u.lastActionAt, now)}` : ''}
                    {u.lastResult?.startsWith('OK') ? '' : ' (refused)'}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <div className="flex flex-wrap gap-1">
                  {u.scanners.map((s) => (
                    <Badge key={s} variant="secondary" className="font-mono text-[10px]">
                      {s.replace(/^RT_/, '')}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell numeric>{u.findings}</TableCell>
              <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground sm:table-cell">{ago(u.last, now)}</TableCell>
              <TableCell>
                {u.protected ? (
                  <Badge variant="outline">Protected</Badge>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="secondary" disabled={mutation.isPending} onClick={() => run(u.user, 'ABORT_QUERIES')}>
                      Abort queries
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-destructive/60 text-destructive hover:bg-destructive/10"
                      disabled={mutation.isPending}
                      onClick={() => {
                        setTyped('');
                        setConfirming(u.user);
                      }}
                    >
                      Disable…
                    </Button>
                    <Button size="sm" variant="ghost" disabled={mutation.isPending} onClick={() => run(u.user, 'ENABLE_USER', true)}>
                      Enable
                    </Button>
                    {u.autoContain ? <Badge variant="warning">auto</Badge> : null}
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable {confirming}?</DialogTitle>
            <DialogDescription>
              This blocks the user from logging in until someone enables the account again. Running queries are cancelled. The action
              is written to the containment log. Type the user name to confirm.
            </DialogDescription>
          </DialogHeader>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">User name</span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!confirming || typed.trim().toUpperCase() !== confirming.toUpperCase() || mutation.isPending}
              onClick={() => {
                if (confirming) run(confirming, 'DISABLE_USER', true);
                setConfirming(null);
              }}
            >
              Disable user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
