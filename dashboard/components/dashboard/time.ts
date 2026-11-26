/** Time helpers. Epoch values from the API are in seconds; displays use the viewer's local time zone. */
const hm = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
const hms = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const dayTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

export const fmtHm = (epochSec: number) => hm.format(new Date(epochSec * 1000));
export const fmtHms = (epochSec: number) => hms.format(new Date(epochSec * 1000));
export const fmtDayTime = (epochSec: number) => dayTime.format(new Date(epochSec * 1000));

export function ago(epochSec: number, nowMs: number): string {
  const s = Math.max(0, Math.round(nowMs / 1000 - epochSec));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function updatedAgo(fetchedAtMs: number | undefined, nowMs: number): string {
  if (!fetchedAtMs) return 'loading';
  const s = Math.max(0, Math.round((nowMs - fetchedAtMs) / 1000));
  return s < 2 ? 'just now' : `${s}s ago`;
}
