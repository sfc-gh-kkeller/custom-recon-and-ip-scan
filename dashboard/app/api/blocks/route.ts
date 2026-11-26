import { failure } from '@/lib/errors';
import { num, parseWindow, scannerRefs } from '@/lib/scanner';
import { snowflake } from '@/lib/snowflake';

export const dynamic = 'force-dynamic';

/**
 * Blocked data movement (error 100168) for watched users, live from INFORMATION_SCHEMA.
 * The account-wide QUERY_HISTORY scan gets slow quickly (23 hours took over 5 minutes in testing,
 * 3 hours about 18 seconds), so the window is capped at 3 hours. ACCOUNT_USAGE covers the rest.
 */
export async function GET(req: Request) {
  const win = Math.min(parseWindow(new URL(req.url).searchParams.get('window')), 180);
  try {
    const { info, watched } = await scannerRefs();
    const { rows } = await snowflake.query(`
      SELECT QUERY_ID, USER_NAME, LEFT(QUERY_TEXT, 140) AS QUERY_TEXT,
             DATE_PART('epoch_second', START_TIME) AS START_EPOCH
      FROM TABLE(${info}.QUERY_HISTORY(END_TIME_RANGE_START => DATEADD('minute', -${win}, CURRENT_TIMESTAMP()), RESULT_LIMIT => 10000))
      WHERE ERROR_CODE = 100168 AND UPPER(USER_NAME) IN (${watched})
      ORDER BY START_TIME DESC LIMIT 25`);
    return Response.json({
      fetchedAt: Date.now(),
      window: win,
      blocks: rows.map((r) => ({
        queryId: String(r.QUERY_ID),
        user: String(r.USER_NAME),
        text: String(r.QUERY_TEXT ?? ''),
        at: num(r.START_EPOCH),
      })),
    });
  } catch (e) {
    return failure(e, 'blocks');
  }
}
