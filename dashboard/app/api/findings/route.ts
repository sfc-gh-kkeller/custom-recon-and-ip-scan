import { failure } from '@/lib/errors';
import { num, scannerRefs } from '@/lib/scanner';
import { snowflake } from '@/lib/snowflake';

export const dynamic = 'force-dynamic';

/** Latest scanner findings for watched users in the last 24 hours. */
export async function GET() {
  try {
    const { scanner, watched } = await scannerRefs();
    const { rows } = await snowflake.query(`
      SELECT FINDING_ID, SCANNER_ID, SEVERITY, ENTITY, SUMMARY,
             DATE_PART('epoch_second', DETECTED_AT) AS DETECTED_EPOCH
      FROM ${scanner}.FINDINGS
      WHERE DETECTED_AT >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND UPPER(ENTITY) IN (${watched})
      ORDER BY DETECTED_AT DESC LIMIT 40`);
    return Response.json({
      fetchedAt: Date.now(),
      findings: rows.map((r) => ({
        id: String(r.FINDING_ID),
        scanner: String(r.SCANNER_ID),
        severity: String(r.SEVERITY),
        user: String(r.ENTITY),
        summary: String(r.SUMMARY),
        at: num(r.DETECTED_EPOCH),
      })),
    });
  } catch (e) {
    return failure(e, 'findings');
  }
}
