import { failure } from '@/lib/errors';
import { ACTIONS, scannerRefs } from '@/lib/scanner';
import { snowflake } from '@/lib/snowflake';

export const dynamic = 'force-dynamic';

/**
 * Runs CONTAIN_USER. The procedure itself refuses protected users, users that are not on the
 * watchlist, and DISABLE_USER without confirmed = true; this route validates the input first.
 */
export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.headers.get('host')) {
    return Response.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    user?: unknown;
    action?: unknown;
    confirmed?: unknown;
  } | null;
  const user = typeof body?.user === 'string' ? body.user.trim() : '';
  const action = typeof body?.action === 'string' ? body.action : '';
  const confirmed = body?.confirmed === true;

  if (!user || user.length > 255) return Response.json({ error: 'A user name is required.' }, { status: 400 });
  if (!(ACTIONS as readonly string[]).includes(action)) {
    return Response.json({ error: 'Unknown action.' }, { status: 400 });
  }
  if (action === 'DISABLE_USER' && !confirmed) {
    return Response.json({ error: 'Disabling a user needs explicit confirmation.' }, { status: 400 });
  }

  try {
    const { scanner } = await scannerRefs();
    const { rows } = await snowflake.query(`CALL ${scanner}.CONTAIN_USER(?, ?, ?, ?)`, {
      binds: [user, action, 'dashboard', confirmed],
    });
    const result = String(Object.values(rows[0] ?? {})[0] ?? '');
    return Response.json({ ok: result.startsWith('OK'), result });
  } catch (e) {
    return failure(e, 'contain');
  }
}
