import { failure } from '@/lib/errors';
import { num, scannerRefs } from '@/lib/scanner';
import { snowflake } from '@/lib/snowflake';

export const dynamic = 'force-dynamic';

/** The containment audit log, newest first. */
export async function GET() {
  try {
    const { scanner } = await scannerRefs();
    const { rows } = await snowflake.query(`
      SELECT DATE_PART('epoch_second', TS) AS TS_EPOCH, USER_NAME, ACTION, REQUESTED_BY, CONFIRMED, RESULT
      FROM ${scanner}.CONTAINMENT_LOG ORDER BY TS DESC LIMIT 25`);
    return Response.json({
      fetchedAt: Date.now(),
      entries: rows.map((r) => ({
        at: num(r.TS_EPOCH),
        user: String(r.USER_NAME),
        action: String(r.ACTION),
        by: String(r.REQUESTED_BY),
        confirmed: r.CONFIRMED === true || r.CONFIRMED === 'true',
        result: String(r.RESULT),
      })),
    });
  } catch (e) {
    return failure(e, 'containment');
  }
}
