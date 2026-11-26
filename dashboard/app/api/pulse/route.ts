import { failure } from '@/lib/errors';
import { bucketMinutes, num, parseWindow, scannerRefs } from '@/lib/scanner';
import { snowflake } from '@/lib/snowflake';

export const dynamic = 'force-dynamic';

/** Login activity for watched users from INFORMATION_SCHEMA (no ACCOUNT_USAGE lag). */
export async function GET(req: Request) {
  const win = parseWindow(new URL(req.url).searchParams.get('window'));
  const bucket = bucketMinutes(win);
  try {
    const { info, watched } = await scannerRefs();
    const login = `TABLE(${info}.LOGIN_HISTORY(
      TIME_RANGE_START => DATEADD('minute', -${win}, CURRENT_TIMESTAMP()),
      TIME_RANGE_END => CURRENT_TIMESTAMP(), RESULT_LIMIT => 10000))`;
    const scope = `UPPER(USER_NAME) IN (${watched})`;

    const [series, totals, users] = await Promise.all([
      snowflake.query(`
        SELECT FLOOR(DATE_PART('epoch_second', EVENT_TIMESTAMP) / ${bucket * 60}) * ${bucket * 60} AS BUCKET_EPOCH,
               COUNT_IF(IS_SUCCESS = 'YES') AS OK, COUNT_IF(IS_SUCCESS = 'NO') AS FAILED
        FROM ${login} WHERE ${scope} GROUP BY 1 ORDER BY 1`),
      snowflake.query(`
        SELECT COUNT(*) AS ATTEMPTS, COUNT_IF(IS_SUCCESS = 'NO') AS FAILED,
               COUNT(DISTINCT CLIENT_IP) AS IPS, COUNT(DISTINCT USER_NAME) AS USERS
        FROM ${login} WHERE ${scope}`),
      snowflake.query(`
        SELECT USER_NAME, COUNT(*) AS ATTEMPTS, COUNT_IF(IS_SUCCESS = 'NO') AS FAILED,
               COUNT(DISTINCT CLIENT_IP) AS IPS, LISTAGG(DISTINCT REPORTED_CLIENT_TYPE, ', ') AS CLIENTS,
               MAX(DATE_PART('epoch_second', EVENT_TIMESTAMP)) AS LAST_EPOCH
        FROM ${login} WHERE ${scope} GROUP BY USER_NAME ORDER BY ATTEMPTS DESC LIMIT 25`),
    ]);

    const t = totals.rows[0] ?? {};
    return Response.json({
      window: win,
      bucketMinutes: bucket,
      fetchedAt: Date.now(),
      series: series.rows.map((r) => ({ t: num(r.BUCKET_EPOCH), ok: num(r.OK), failed: num(r.FAILED) })),
      totals: { attempts: num(t.ATTEMPTS), failed: num(t.FAILED), ips: num(t.IPS), users: num(t.USERS) },
      users: users.rows.map((r) => ({
        user: String(r.USER_NAME),
        attempts: num(r.ATTEMPTS),
        failed: num(r.FAILED),
        ips: num(r.IPS),
        clients: String(r.CLIENTS ?? ''),
        last: num(r.LAST_EPOCH),
      })),
    });
  } catch (e) {
    return failure(e, 'pulse');
  }
}
