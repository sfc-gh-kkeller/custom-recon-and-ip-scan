import { failure } from '@/lib/errors';
import { num, scannerRefs } from '@/lib/scanner';
import { snowflake } from '@/lib/snowflake';

export const dynamic = 'force-dynamic';

/** Data movement violations from ACCOUNT_USAGE. Up to 3 hours behind, but includes allowed-with-alert events. */
export async function GET() {
  try {
    const { watched } = await scannerRefs();
    const { rows } = await snowflake.query(`
      SELECT QUERY_ID, USER_NAME, MOVEMENT_TYPE, TO_VARCHAR(ENFORCED_POLICY) AS ENFORCED,
             TO_VARCHAR(ALERTED_POLICIES) AS ALERTED, DATE_PART('epoch_second', TIMESTAMP) AS TS_EPOCH
      FROM SNOWFLAKE.ACCOUNT_USAGE.DATA_MOVEMENT_VIOLATIONS
      WHERE TIMESTAMP >= DATEADD('hour', -24, CURRENT_TIMESTAMP()) AND UPPER(USER_NAME) IN (${watched})
      ORDER BY TIMESTAMP DESC LIMIT 25`);
    return Response.json({
      fetchedAt: Date.now(),
      events: rows.map((r) => ({
        queryId: String(r.QUERY_ID),
        user: String(r.USER_NAME),
        movement: String(r.MOVEMENT_TYPE),
        outcome: r.ENFORCED && !['None', '{}', '[]'].includes(String(r.ENFORCED)) ? 'blocked' : 'allowed with alert',
        at: num(r.TS_EPOCH),
      })),
    });
  } catch (e) {
    return failure(e, 'movement-alerts');
  }
}
