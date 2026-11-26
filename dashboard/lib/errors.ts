import { isSarError } from '@snowflake/sar-sdk';

/** Logs the full error server-side and returns a safe message for the browser. */
export function failure(e: unknown, what: string) {
  console.error(new Date().toISOString(), `[${what}]`, e);
  const code = isSarError(e) ? (e.details as { errorCode?: string } | undefined)?.errorCode : undefined;
  const error =
    code === '002003'
      ? 'An object this view needs does not exist or the app cannot see it. Run the scanner SQL files first.'
      : code === '003001'
        ? 'The app role does not have access to what this view needs.'
        : 'The query failed. Check the server log for details.';
  return Response.json({ error, code }, { status: 500 });
}
