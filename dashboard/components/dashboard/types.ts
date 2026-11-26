export interface PulseData {
  window: number;
  bucketMinutes: number;
  fetchedAt: number;
  series: { t: number; ok: number; failed: number }[];
  totals: { attempts: number; failed: number; ips: number; users: number };
  users: { user: string; attempts: number; failed: number; ips: number; clients: string; last: number }[];
}

export interface Finding {
  id: string;
  scanner: string;
  severity: string;
  user: string;
  summary: string;
  at: number;
}
export interface FindingsData {
  fetchedAt: number;
  findings: Finding[];
}

export interface FlaggedUser {
  user: string;
  scanners: string[];
  findings: number;
  high: boolean;
  last: number;
  protected: boolean;
  autoContain: boolean;
  lastAction: string | null;
  lastResult: string | null;
  lastActionAt: number | null;
}
export interface FlaggedData {
  fetchedAt: number;
  users: FlaggedUser[];
}

export interface BlocksData {
  fetchedAt: number;
  window: number;
  blocks: { queryId: string; user: string; text: string; at: number }[];
}

export interface MovementData {
  fetchedAt: number;
  events: { queryId: string; user: string; movement: string; outcome: string; at: number }[];
}

export interface ContainmentData {
  fetchedAt: number;
  entries: { at: number; user: string; action: string; by: string; confirmed: boolean; result: string }[];
}

export interface StatusData {
  fetchedAt: number;
  jobs: { name: string; state: string; schedule: string; kind: 'task' | 'alert' }[];
  population: { watched: number; protected: number };
  thresholds: { windowMinutes: number; ipDistinct: number; failedLogins: number; loginBurst: number; sameIp: number };
}
