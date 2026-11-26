'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

/** Polls an API route. Keeps the previous data on screen while a refresh is in flight. */
export function useLive<T>(url: string, live: boolean, intervalMs: number) {
  return useQuery<T>({
    queryKey: ['live', url],
    queryFn: async () => {
      const r = await fetch(url, { cache: 'no-store' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? 'Request failed');
      return body as T;
    },
    refetchInterval: live ? intervalMs : false,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
    retry: 1,
  });
}

/** A clock that ticks once a second, for "updated Ns ago" labels. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
