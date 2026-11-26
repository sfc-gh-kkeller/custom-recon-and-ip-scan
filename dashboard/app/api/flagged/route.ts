import { failure } from '@/lib/errors';
import { num, scannerRefs } from '@/lib/scanner';
import { snowflake } from '@/lib/snowflake';

export const dynamic = 'force-dynamic';

/** One row per flagged watched user: scanners, severity, protection and last containment action. */
export async function GET() {
  try {
    const { scanner, watched } = await scannerRefs();
    const { rows } = await snowflake.query(`
      WITH f AS (
        SELECT UPPER(ENTITY) AS U, MAX(ENTITY) AS USER_NAME, LISTAGG(DISTINCT SCANNER_ID, ',') AS SCANNERS,
               COUNT(*) AS N, MAX(IFF(SEVERITY = 'HIGH', 1, 0)) AS HIGH,
               MAX(DATE_PART('epoch_second', DETECTED_AT)) AS LAST_EPOCH
        FROM ${scanner}.FINDINGS
        WHERE DETECTED_AT >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND UPPER(ENTITY) IN (${watched})
        GROUP BY UPPER(ENTITY)),
      p AS (SELECT DISTINCT UPPER(USER_NAME) AS U FROM ${scanner}.PROTECTED_USERS),
      w AS (SELECT UPPER(USER_NAME) AS U, COALESCE(AUTO_CONTAIN, FALSE) AS AUTO_CONTAIN FROM ${scanner}.WATCHED_USERS),
      l AS (SELECT UPPER(USER_NAME) AS U, ACTION, RESULT, DATE_PART('epoch_second', TS) AS TS_EPOCH
            FROM ${scanner}.CONTAINMENT_LOG
            QUALIFY ROW_NUMBER() OVER (PARTITION BY UPPER(USER_NAME) ORDER BY TS DESC) = 1)
      SELECT f.USER_NAME, f.SCANNERS, f.N, f.HIGH, f.LAST_EPOCH, p.U IS NOT NULL AS PROTECTED,
             w.AUTO_CONTAIN, l.ACTION AS LAST_ACTION, l.RESULT AS LAST_RESULT, l.TS_EPOCH AS LAST_ACTION_EPOCH
      FROM f LEFT JOIN p ON p.U = f.U LEFT JOIN w ON w.U = f.U LEFT JOIN l ON l.U = f.U
      ORDER BY f.HIGH DESC, f.N DESC LIMIT 50`);
    return Response.json({
      fetchedAt: Date.now(),
      users: rows.map((r) => ({
        user: String(r.USER_NAME),
        scanners: String(r.SCANNERS ?? '').split(',').filter(Boolean),
        findings: num(r.N),
        high: num(r.HIGH) === 1,
        last: num(r.LAST_EPOCH),
        protected: r.PROTECTED === true || r.PROTECTED === 'true',
        autoContain: r.AUTO_CONTAIN === true || r.AUTO_CONTAIN === 'true',
        lastAction: r.LAST_ACTION ? String(r.LAST_ACTION) : null,
        lastResult: r.LAST_RESULT ? String(r.LAST_RESULT) : null,
        lastActionAt: r.LAST_ACTION_EPOCH ? num(r.LAST_ACTION_EPOCH) : null,
      })),
    });
  } catch (e) {
    return failure(e, 'flagged');
  }
}
