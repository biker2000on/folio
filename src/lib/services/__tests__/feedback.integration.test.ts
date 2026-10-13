/**
 * Real-PostgreSQL cover for in-app feedback storage.
 *
 * The unit suite proves validation and formatting; what only Postgres can
 * prove is the raw SQL: the triage CASE that stamps / clears resolved_at and
 * re-arms the submitter's notice, the int[] binds (including the empty
 * "acknowledge all" array), the per-user rate-limit window and the operator
 * lookup by id / username / email.
 *
 * TEST DATA: every user is tagged with a per-run id and deleted (cascading
 * to their feedback) in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getTestPool } from '@/__tests__/integration/db';

vi.mock('@/lib/storage/storage-backend', () => ({
  getStorageBackend: async () => ({
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => Buffer.from([0xff, 0xd8, 0xff, 0xe0])),
  }),
}));

const RUN = randomUUID().slice(0, 8);
type Service = typeof import('@/lib/services/feedback.service');
let svc: Service;
let submitterId = 0;
let operatorId = 0;

async function insertUser(username: string, email: string | null = null): Promise<number> {
  const res = await getTestPool().query(
    `INSERT INTO gnucash_web_users (username, password_hash, email) VALUES ($1, 'x', $2) RETURNING id`,
    [username, email],
  );
  return res.rows[0].id as number;
}

describe('feedback storage (real Postgres)', () => {
  beforeAll(async () => {
    svc = await import('@/lib/services/feedback.service');
    await svc.ensureFeedbackTable();
    submitterId = await insertUser(`fb-sub-${RUN}`);
    operatorId = await insertUser(`fb-op-${RUN}`, `op-${RUN}@integration.test`);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await getTestPool().query(`DELETE FROM gnucash_web_users WHERE username LIKE $1`, [`fb-%-${RUN}`]);
  });

  it('creates, lists and stores a screenshot key', async () => {
    const item = await svc.createFeedback(submitterId, {
      kind: 'bug',
      body: 'Ledger total is off',
      route: '/ledger?x=1',
      context: { viewport: '1x1' },
      screenshot: { data: Buffer.from([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' },
    });
    expect(item.status).toBe('new');
    expect(item.has_screenshot).toBe(true);
    expect(item.screenshot_key).toBe(`feedback/${submitterId}/${item.id}.jpg`);
    expect(item.context).toEqual({ viewport: '1x1' });
    expect(item.app_version).not.toBe('');

    const mine = await svc.listUserFeedback(submitterId);
    expect(mine.map((f) => f.id)).toEqual([item.id]);
    expect((await svc.getFeedback(item.id))?.screenshot_key).toBe(item.screenshot_key);
    expect(await svc.countRecentFeedback(submitterId)).toBe(1);

    const inbox = await svc.listAllFeedback('new');
    const row = inbox.find((f) => f.id === item.id);
    expect(row?.user_name).toBe(`fb-sub-${RUN}`);
  });

  it('stamps, re-arms and clears the resolution through triage', async () => {
    const item = await svc.createFeedback(submitterId, {
      kind: 'idea', body: 'Dark charts', route: '', context: {}, screenshot: null,
    });

    const triaged = await svc.updateFeedbackTriage(item.id, { status: 'triaged' });
    expect(triaged?.resolved_at).toBeNull();

    const done = await svc.updateFeedbackTriage(item.id, { status: 'done', adminNote: 'Shipped' });
    expect(done?.resolved_at).not.toBeNull();
    expect(done?.admin_note).toBe('Shipped');

    // A note edit on a closed item keeps the original resolution stamp.
    const noted = await svc.updateFeedbackTriage(item.id, { adminNote: 'Shipped in 0.24' });
    expect(noted?.resolved_at).toBe(done?.resolved_at);
    expect(noted?.status).toBe('done');

    await svc.markFeedbackResolutionSeen(submitterId, []);
    expect((await svc.getFeedback(item.id))?.resolution_seen_at).not.toBeNull();

    // Reopening clears both; closing again re-arms the notice.
    const reopened = await svc.updateFeedbackTriage(item.id, { status: 'new' });
    expect(reopened?.resolved_at).toBeNull();
    expect(reopened?.resolution_seen_at).toBeNull();
    const closed = await svc.updateFeedbackTriage(item.id, { status: 'wontfix' });
    expect(closed?.resolved_at).not.toBeNull();
    expect(closed?.resolution_seen_at).toBeNull();

    // Acknowledging by id only touches the listed item, and only the owner's.
    await svc.markFeedbackResolutionSeen(operatorId, [item.id]);
    expect((await svc.getFeedback(item.id))?.resolution_seen_at).toBeNull();
    await svc.markFeedbackResolutionSeen(submitterId, [item.id]);
    expect((await svc.getFeedback(item.id))?.resolution_seen_at).not.toBeNull();

    expect(await svc.updateFeedbackTriage(2147483000, { status: 'done' })).toBeNull();
  });

  it('resolves operators by id, username or email', async () => {
    vi.stubEnv('FEEDBACK_ADMIN_USERS', `op-${RUN}@integration.test`);
    expect(await svc.getFeedbackAdminIds()).toEqual([operatorId]);
    expect(await svc.isFeedbackAdmin(submitterId)).toBe(false);

    vi.stubEnv('FEEDBACK_ADMIN_USERS', `FB-SUB-${RUN}, ${operatorId}`);
    expect((await svc.getFeedbackAdminIds()).sort((a, b) => a - b)).toEqual([submitterId, operatorId].sort((a, b) => a - b));
  });

  it('counts every status', async () => {
    const counts = await svc.feedbackStatusCounts();
    expect(Object.keys(counts).sort()).toEqual(['done', 'new', 'triaged', 'wontfix']);
    expect(counts.new).toBeGreaterThanOrEqual(1);
  });
});
