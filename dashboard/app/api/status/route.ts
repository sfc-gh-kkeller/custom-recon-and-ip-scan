import { failure } from '@/lib/errors';
import { num, scannerRefs } from '@/lib/scanner';
import { snowflake } from '@/lib/snowflake';

export const dynamic = 'force-dynamic';

/** Scanner tasks, alerts, thresholds and population sizes. */
export async function GET() {
  try {
    const { scanner, alerts } = await scannerRefs();
    const [tasks, alertRows, cfg] = await Promise.all([
      snowflake.query(`SHOW TASKS IN SCHEMA ${scanner}`, { format: 'native' }),
      snowflake.query(`SHOW ALERTS IN SCHEMA ${alerts}`, { format: 'native' }),
      snowflake.query(`
        SELECT (SELECT COUNT(*) FROM ${scanner}.WATCHED_USERS) AS WATCHED,
               (SELECT COUNT(*) FROM ${scanner}.PROTECTED_USERS) AS PROTECTED, c.*
        FROM ${scanner}.RT_CONFIG c LIMIT 1`),
    ]);
    const c = cfg.rows[0] ?? {};
    const pick = (r: Record<string, unknown>) => ({
      name: String(r.name),
      state: String(r.state),
      schedule: r.schedule ? String(r.schedule) : '',
    });
    return Response.json({
      fetchedAt: Date.now(),
      jobs: [...tasks.rows.map(pick).map((j) => ({ ...j, kind: 'task' })), ...alertRows.rows.map(pick).map((j) => ({ ...j, kind: 'alert' }))],
      population: { watched: num(c.WATCHED), protected: num(c.PROTECTED) },
      thresholds: {
        windowMinutes: num(c.WINDOW_MINUTES),
        ipDistinct: num(c.IP_DISTINCT_MIN),
        failedLogins: num(c.FAILED_LOGIN_MIN),
        loginBurst: num(c.LOGIN_BURST_MIN),
        sameIp: num(c.SAME_IP_MIN),
      },
    });
  } catch (e) {
    return failure(e, 'status');
  }
}
