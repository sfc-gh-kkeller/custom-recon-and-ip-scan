import { quoteIdent, resolveDatabase } from '@/lib/run-as';

export const WINDOWS = [15, 30, 60, 180, 720] as const;
export type WindowMinutes = (typeof WINDOWS)[number];

export function parseWindow(raw: string | null): WindowMinutes {
  const n = Number(raw);
  return (WINDOWS as readonly number[]).includes(n) ? (n as WindowMinutes) : 60;
}

/** Minutes per timeline bucket, so long windows stay readable. */
export function bucketMinutes(window: number): number {
  if (window <= 60) return 1;
  if (window <= 180) return 5;
  return 15;
}

export const ACTIONS = ['ABORT_QUERIES', 'DISABLE_USER', 'ENABLE_USER'] as const;
export type ContainAction = (typeof ACTIONS)[number];

/**
 * Fully qualified references to the scanner objects. The database defaults to the
 * app's current database; override with SCANNER_DB, SCANNER_SCHEMA and ALERT_SCHEMA.
 */
export async function scannerRefs() {
  const db = process.env.SCANNER_DB ? quoteIdent(process.env.SCANNER_DB) : await resolveDatabase();
  if (!db) throw new Error('No database available for the scanner objects');
  const scanner = `${db}.${quoteIdent(process.env.SCANNER_SCHEMA ?? 'TRUST_SCANNER')}`;
  return {
    scanner,
    alerts: `${db}.${quoteIdent(process.env.ALERT_SCHEMA ?? 'DMP_DEMO')}`,
    info: `${db}.INFORMATION_SCHEMA`,
    watched: `SELECT UPPER(USER_NAME) FROM ${scanner}.WATCHED_USERS`,
  };
}

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
