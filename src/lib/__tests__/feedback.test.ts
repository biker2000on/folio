import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn() }));
vi.mock('@/lib/storage/storage-backend', () => ({ getStorageBackend: vi.fn() }));

import {
  buildFeedbackContext,
  dataURLBytes,
  feedbackAge,
  routeEntities,
  unseenResolved,
  type FeedbackItem,
} from '@/lib/feedback';
import {
  decodeScreenshot,
  FeedbackValidationError,
  formatFeedbackNotification,
  parseAdminList,
  sniffImageType,
  toPublic,
  validateFeedback,
  type StoredFeedback,
} from '@/lib/services/feedback.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const dataUrl = (buf: Buffer, type = 'image/png') => `data:${type};base64,${buf.toString('base64')}`;

describe('routeEntities', () => {
  it('pulls record ids out of the path', () => {
    expect(routeEntities('/accounts/0a1b2c3d4e5f60718293a4b5c6d7e8f9')).toEqual({
      account_guid: '0a1b2c3d4e5f60718293a4b5c6d7e8f9',
    });
    expect(routeEntities('/business/invoices/42/edit')).toEqual({ invoice_id: '42' });
  });

  it('ignores non-id segments', () => {
    expect(routeEntities('/accounts')).toEqual({});
    expect(routeEntities('/budgets/compare')).toEqual({});
    expect(routeEntities('/')).toEqual({});
  });
});

describe('buildFeedbackContext', () => {
  it('records environment, entities and the active book', () => {
    const ctx = buildFeedbackContext({
      pathname: '/accounts/abc123',
      search: '?tab=ledger',
      title: 'Checking · Folio',
      viewport: { width: 390, height: 844 },
      devicePixelRatio: 3,
      userAgent: 'UA',
      theme: 'dark',
      timezone: 'America/New_York',
      standalone: true,
      activeBookGuid: 'book1',
    });
    expect(ctx).toMatchObject({
      viewport: '390x844',
      query: '?tab=ledger',
      account_guid: 'abc123',
      installed_app: true,
      active_book_guid: 'book1',
    });
    expect(JSON.stringify(ctx).length).toBeLessThan(8 * 1024);
  });
});

const item = (over: Partial<FeedbackItem>): FeedbackItem => ({
  id: 1,
  user_id: 1,
  kind: 'bug',
  body: 'x',
  route: '/',
  context: {},
  app_version: '',
  has_screenshot: false,
  status: 'new',
  admin_note: '',
  resolved_at: null,
  resolution_seen_at: null,
  created_at: '',
  updated_at: '',
  ...over,
});

describe('unseenResolved', () => {
  it('returns closed items not yet acknowledged', () => {
    const items = [
      item({ id: 1 }),
      item({ id: 2, status: 'done', resolved_at: '2026-10-09T00:00:00Z' }),
      item({ id: 3, status: 'done', resolved_at: '2026-10-09T00:00:00Z', resolution_seen_at: '2026-10-09T01:00:00Z' }),
    ];
    expect(unseenResolved(items).map((i) => i.id)).toEqual([2]);
  });
});

describe('dataURLBytes', () => {
  it('measures the decoded payload', () => {
    expect(dataURLBytes('data:image/png;base64,AAAA')).toBe(3);
    expect(dataURLBytes('data:image/png;base64,AA==')).toBe(1);
  });
});

describe('feedbackAge', () => {
  it('renders a compact age', () => {
    const now = new Date('2026-10-13T12:00:00Z');
    expect(feedbackAge('2026-10-13T11:59:30Z', now)).toBe('just now');
    expect(feedbackAge('2026-10-13T11:55:00Z', now)).toBe('5m ago');
    expect(feedbackAge('2026-10-13T09:00:00Z', now)).toBe('3h ago');
    expect(feedbackAge('2026-10-11T12:00:00Z', now)).toBe('2d ago');
  });
});

describe('sniffImageType / decodeScreenshot', () => {
  it('trusts the bytes, not the declared type', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(WEBP)).toBe('image/webp');
    expect(decodeScreenshot(dataUrl(JPEG, 'image/png')).contentType).toBe('image/jpeg');
  });

  it('rejects non-images and malformed data URLs', () => {
    expect(() => decodeScreenshot(dataUrl(Buffer.from('<svg/>'), 'image/svg+xml'))).toThrow(FeedbackValidationError);
    expect(() => decodeScreenshot('https://example.com/a.png')).toThrow(/data URL/);
    expect(() => decodeScreenshot('data:image/png;base64,@@@')).toThrow(/base64/);
  });

  it('enforces the 5 MB cap', () => {
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    expect(() => decodeScreenshot(dataUrl(big))).toThrow(/at most 5 MB/);
  });
});

describe('validateFeedback', () => {
  it('trims and accepts a valid submission', () => {
    const v = validateFeedback({ kind: ' idea ', body: '  more charts  ', route: '/reports', context: { a: 1 } });
    expect(v).toEqual({ kind: 'idea', body: 'more charts', route: '/reports', context: { a: 1 }, screenshot: null });
  });

  it('decodes an attached screenshot', () => {
    const v = validateFeedback({ kind: 'bug', body: 'x', screenshot: dataUrl(PNG) });
    expect(v.screenshot?.contentType).toBe('image/png');
  });

  it.each([
    [{ kind: 'rant', body: 'x' }, /kind must be/],
    [{ kind: 'bug', body: '   ' }, /body is required/],
    [{ kind: 'bug', body: 'x'.repeat(5001) }, /at most 5000/],
    [{ kind: 'bug', body: 'x', context: [1] }, /JSON object/],
    [{ kind: 'bug', body: 'x', context: { blob: 'y'.repeat(9000) } }, /too large/],
    [{ kind: 'bug', body: 'x', screenshot: 42 }, /data URL/],
    [null, /invalid JSON/],
  ])('rejects %j', (input, message) => {
    expect(() => validateFeedback(input)).toThrow(message);
  });

  it('truncates an overlong route rather than rejecting', () => {
    expect(validateFeedback({ kind: 'bug', body: 'x', route: '/a'.repeat(400) }).route).toHaveLength(500);
  });
});

describe('parseAdminList', () => {
  it('splits ids, usernames and emails', () => {
    expect(parseAdminList('1, Alice;bob@Example.com\n 7 carol')).toEqual({
      ids: [1, 7],
      names: ['alice', 'carol'],
      emails: ['bob@example.com'],
    });
    expect(parseAdminList(undefined)).toEqual({ ids: [], names: [], emails: [] });
  });
});

describe('formatFeedbackNotification', () => {
  it('names the kind, the sender and the page', () => {
    const { title, message } = formatFeedbackNotification(
      { id: 9, kind: 'bug', body: 'Ledger crashes', route: '/ledger', has_screenshot: true },
      'Justin',
    );
    expect(title).toBe('Folio bug from Justin');
    expect(message).toBe('Ledger crashes\nPage: /ledger\n(screenshot attached)');
  });

  it('flags data reports and truncates long bodies', () => {
    const { title, message } = formatFeedbackNotification(
      { id: 9, kind: 'data', body: 'y'.repeat(500), route: '', has_screenshot: false },
      'Sam',
    );
    expect(title).toBe('Folio: Data looks wrong (Sam)');
    expect(message).toBe(`${'y'.repeat(400)}…`);
  });
});

describe('toPublic', () => {
  it('never exposes the object key', () => {
    const stored: StoredFeedback = { ...item({ has_screenshot: true }), screenshot_key: 'feedback/1/1.jpg' };
    expect(toPublic(stored)).not.toHaveProperty('screenshot_key');
    expect(toPublic(stored).has_screenshot).toBe(true);
  });
});
