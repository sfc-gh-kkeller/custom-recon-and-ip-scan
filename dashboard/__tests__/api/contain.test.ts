import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../app/api/contain/route';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../../lib/snowflake', () => ({
  snowflake: { query: mocks.query },
  asCaller: vi.fn(),
}));

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request('http://localhost:3000/api/contain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', host: 'localhost:3000', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

describe('POST /api/contain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SCANNER_DB = 'DEMO_DB';
  });

  it('rejects a missing user', async () => {
    const res = await post({ action: 'ABORT_QUERIES' });
    expect(res.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects an unknown action', async () => {
    const res = await post({ user: 'ALICE', action: 'DROP_USER', confirmed: true });
    expect(res.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    const res = await post('not json');
    expect(res.status).toBe(400);
  });

  it('rejects DISABLE_USER without explicit confirmation', async () => {
    const res = await post({ user: 'ALICE', action: 'DISABLE_USER', confirmed: false });
    expect(res.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects cross-origin requests', async () => {
    const res = await post({ user: 'ALICE', action: 'ABORT_QUERIES' }, { origin: 'http://evil.example' });
    expect(res.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('calls CONTAIN_USER with binds, never string-concatenated input', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ CONTAIN_USER: 'OK: aborted running queries for ALICE' }] });
    const res = await post({ user: "ALICE'; DROP TABLE x; --", action: 'ABORT_QUERIES' }, { origin: 'http://localhost:3000' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: 'OK: aborted running queries for ALICE' });
    const [sql, options] = mocks.query.mock.calls[0];
    expect(sql).toContain('CONTAIN_USER(?, ?, ?, ?)');
    expect(sql).not.toContain('DROP TABLE');
    expect(options.binds).toEqual(["ALICE'; DROP TABLE x; --", 'ABORT_QUERIES', 'dashboard', false]);
  });

  it('reports a refusal from the procedure as ok: false', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ CONTAIN_USER: 'REFUSED: protected user' }] });
    const res = await post({ user: 'ADMIN', action: 'ABORT_QUERIES' });
    expect(await res.json()).toEqual({ ok: false, result: 'REFUSED: protected user' });
  });

  it('returns a safe error when the query fails', async () => {
    mocks.query.mockRejectedValueOnce(new Error('secret SQL text'));
    const res = await post({ user: 'ALICE', action: 'ABORT_QUERIES' });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret SQL text');
  });
});
