'use client';

import { Skeleton } from '@/components/ui/skeleton';
import type { ReactNode } from 'react';
import { useNow } from './use-live';
import { updatedAgo } from './time';

/** A titled panel with its own loading, error and empty states. Lines, not boxes. */
export function Section({
  title,
  note,
  fetchedAt,
  loading,
  error,
  empty,
  emptyText,
  children,
  className = '',
}: {
  title: string;
  note?: string;
  fetchedAt?: number;
  loading: boolean;
  error: Error | null;
  empty?: boolean;
  emptyText?: string;
  children: ReactNode;
  className?: string;
}) {
  const now = useNow();
  return (
    <section className={`min-w-0 animate-rise ${className}`} aria-label={title}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2">
        <h2 className="font-display text-lg uppercase tracking-wide text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground tnum">
          {note ? `${note} · ` : ''}
          {fetchedAt ? `updated ${updatedAgo(fetchedAt, now)}` : ''}
        </p>
      </header>
      <div className="pt-3">
        {loading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-5/6" />
            <Skeleton className="h-6 w-4/6" />
          </div>
        ) : error ? (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ) : empty ? (
          <p className="text-sm text-muted-foreground">{emptyText ?? 'Nothing to show.'}</p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

export function SeverityDot({ severity }: { severity: string }) {
  const high = severity === 'HIGH';
  return (
    <span
      aria-label={`${severity} severity`}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${high ? 'bg-destructive' : 'bg-warning'}`}
    />
  );
}
