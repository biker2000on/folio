/**
 * In-app feedback, server side.
 *
 * Anything a signed-in person sends from the feedback dialog lands in
 * `gnucash_web_feedback` with the page context captured alongside it (route,
 * viewport, app version) so a "this balance looks wrong" report arrives
 * pointing at the exact account. Operators triage it at /admin/feedback;
 * moving an item to Done / Won't fix shows the submitter a one-time notice
 * with the operator's note (`resolution_seen_at`).
 *
 * Screenshots go to the receipt object store (MinIO in production) under
 * `feedback/{userId}/{id}.{ext}`. Feedback is per person, never per book.
 *
 * Operators: FEEDBACK_ADMIN_USERS lists user ids, usernames or emails. Unset,
 * the instance owner (the first user created) is the operator, which is what
 * a self-hosted install wants without any configuration.
 */
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import packageJson from '../../../package.json';
import { createNotification } from '@/lib/notifications';
import { getStorageBackend } from '@/lib/storage/storage-backend';
import {
  FEEDBACK_CLOSED_STATUSES,
  FEEDBACK_KIND_IDS,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_MAX_BODY,
  FEEDBACK_MAX_CONTEXT_BYTES,
  FEEDBACK_MAX_ROUTE,
  FEEDBACK_MAX_SCREENSHOT_BYTES,
  FEEDBACK_STATUSES,
  type FeedbackItem,
  type FeedbackKind,
  type FeedbackStatus,
} from '@/lib/feedback';
import { product } from '@/lib/product';

/** Submissions per user per FEEDBACK_RATE_WINDOW_MINUTES, counted in the DB. */
export const FEEDBACK_RATE_LIMIT = 20;
export const FEEDBACK_RATE_WINDOW_MINUTES = 60;
/**
 * The request carries the screenshot base64-encoded inside JSON, so the
 * envelope allows for the 4/3 expansion plus the other fields.
 */
export const FEEDBACK_MAX_REQUEST_BYTES = Math.ceil((FEEDBACK_MAX_SCREENSHOT_BYTES * 4) / 3) + 64 * 1024;

export class FeedbackValidationError extends Error {}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

let ensurePromise: Promise<void> | null = null;

export function ensureFeedbackTable(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          PERFORM pg_advisory_xact_lock(hashtext('gnucash_web_feedback_schema'));

          CREATE TABLE IF NOT EXISTS gnucash_web_feedback (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES gnucash_web_users(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK (kind IN ('bug', 'idea', 'data', 'other')),
            body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
            route TEXT NOT NULL DEFAULT '',
            context JSONB NOT NULL DEFAULT '{}'::jsonb,
            app_version TEXT NOT NULL DEFAULT '',
            screenshot_key TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'done', 'wontfix')),
            admin_note TEXT NOT NULL DEFAULT '',
            resolved_at TIMESTAMPTZ,
            resolution_seen_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );

          CREATE INDEX IF NOT EXISTS idx_feedback_status_created
            ON gnucash_web_feedback(status, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_feedback_user_created
            ON gnucash_web_feedback(user_id, created_at DESC);
        END $$;
      `);
    })();
    // The DDL is idempotent: a transient failure must not poison the memo.
    ensurePromise.catch(() => { ensurePromise = null; });
  }
  return ensurePromise;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface FeedbackRow {
  id: number;
  user_id: number;
  kind: FeedbackKind;
  body: string;
  route: string;
  context: unknown;
  app_version: string;
  screenshot_key: string;
  status: FeedbackStatus;
  admin_note: string;
  resolved_at: Date | null;
  resolution_seen_at: Date | null;
  created_at: Date;
  updated_at: Date;
  user_name?: string | null;
  user_email?: string | null;
}

/** A stored row plus the object key, which never leaves the server. */
export interface StoredFeedback extends FeedbackItem {
  screenshot_key: string;
}

const COLUMNS = Prisma.sql`f.id, f.user_id, f.kind, f.body, f.route, f.context, f.app_version,
  f.screenshot_key, f.status, f.admin_note, f.resolved_at, f.resolution_seen_at,
  f.created_at, f.updated_at`;

function iso(value: Date | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function toStored(row: FeedbackRow): StoredFeedback {
  const context = row.context && typeof row.context === 'object' && !Array.isArray(row.context)
    ? row.context as Record<string, unknown>
    : {};
  const item: StoredFeedback = {
    id: row.id,
    user_id: row.user_id,
    kind: row.kind,
    body: row.body,
    route: row.route,
    context,
    app_version: row.app_version,
    has_screenshot: row.screenshot_key !== '',
    screenshot_key: row.screenshot_key,
    status: row.status,
    admin_note: row.admin_note,
    resolved_at: iso(row.resolved_at),
    resolution_seen_at: iso(row.resolution_seen_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
  if (row.user_name !== undefined) item.user_name = row.user_name ?? '';
  if (row.user_email !== undefined) item.user_email = row.user_email ?? '';
  return item;
}

/** Strips the object key before a row is sent to a browser. */
export function toPublic(item: StoredFeedback): FeedbackItem {
  const { screenshot_key: _key, ...rest } = item;
  return rest;
}

// ---------------------------------------------------------------------------
// Validation (pure)
// ---------------------------------------------------------------------------

export interface ValidFeedback {
  kind: FeedbackKind;
  body: string;
  route: string;
  context: Record<string, unknown>;
  screenshot: { data: Buffer; contentType: string } | null;
}

/** Sniffs the image type from magic bytes rather than trusting the label. */
export function sniffImageType(data: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** Accepts a base64 data URL and sniffs the bytes. */
export function decodeScreenshot(dataURL: string): { data: Buffer; contentType: string } {
  const comma = dataURL.indexOf(',');
  const meta = comma === -1 ? '' : dataURL.slice(0, comma);
  if (!meta.startsWith('data:') || !meta.endsWith(';base64')) {
    throw new FeedbackValidationError('screenshot must be a base64 data URL');
  }
  const payload = dataURL.slice(comma + 1);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
    throw new FeedbackValidationError('screenshot is not valid base64');
  }
  const data = Buffer.from(payload, 'base64');
  if (data.length > FEEDBACK_MAX_SCREENSHOT_BYTES) {
    throw new FeedbackValidationError(`screenshot must be at most ${FEEDBACK_MAX_SCREENSHOT_BYTES / (1024 * 1024)} MB`);
  }
  const contentType = sniffImageType(data);
  if (!contentType) throw new FeedbackValidationError('screenshot must be a PNG, JPEG or WebP image');
  return { data, contentType };
}

export function validateFeedback(input: unknown): ValidFeedback {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new FeedbackValidationError('invalid JSON body');
  }
  const raw = input as Record<string, unknown>;
  const kind = typeof raw.kind === 'string' ? raw.kind.trim() : '';
  if (!FEEDBACK_KIND_IDS.includes(kind as FeedbackKind)) {
    throw new FeedbackValidationError(`kind must be one of ${FEEDBACK_KIND_IDS.join(', ')}`);
  }
  const body = typeof raw.body === 'string' ? raw.body.trim() : '';
  if (!body) throw new FeedbackValidationError('body is required');
  if ([...body].length > FEEDBACK_MAX_BODY) {
    throw new FeedbackValidationError(`body must be at most ${FEEDBACK_MAX_BODY} characters`);
  }
  const route = (typeof raw.route === 'string' ? raw.route.trim() : '').slice(0, FEEDBACK_MAX_ROUTE);

  let context: Record<string, unknown> = {};
  if (raw.context !== undefined && raw.context !== null) {
    if (typeof raw.context !== 'object' || Array.isArray(raw.context)) {
      throw new FeedbackValidationError('context must be a JSON object');
    }
    if (Buffer.byteLength(JSON.stringify(raw.context)) > FEEDBACK_MAX_CONTEXT_BYTES) {
      throw new FeedbackValidationError('context is too large');
    }
    context = raw.context as Record<string, unknown>;
  }

  let screenshot: ValidFeedback['screenshot'] = null;
  if (typeof raw.screenshot === 'string' && raw.screenshot !== '') {
    screenshot = decodeScreenshot(raw.screenshot);
  } else if (raw.screenshot !== undefined && raw.screenshot !== null && raw.screenshot !== '') {
    throw new FeedbackValidationError('screenshot must be a base64 data URL');
  }
  return { kind: kind as FeedbackKind, body, route, context, screenshot };
}

export function screenshotExt(contentType: string): string {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/webp') return 'webp';
  return 'png';
}

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

export interface AdminList {
  ids: number[];
  names: string[];
  emails: string[];
}

/** Splits FEEDBACK_ADMIN_USERS into user ids, usernames and emails. */
export function parseAdminList(raw: string | undefined): AdminList {
  const out: AdminList = { ids: [], names: [], emails: [] };
  for (const part of (raw ?? '').split(/[\s,;]+/).filter(Boolean)) {
    const value = part.toLowerCase();
    if (value.includes('@')) out.emails.push(value);
    else if (/^\d+$/.test(value)) out.ids.push(Number(value));
    else out.names.push(value);
  }
  return out;
}

function configuredAdmins(): AdminList {
  return parseAdminList(process.env.FEEDBACK_ADMIN_USERS);
}

function adminListEmpty(list: AdminList): boolean {
  return !list.ids.length && !list.names.length && !list.emails.length;
}

/** The users who triage feedback: the configured list, else the instance owner. */
export async function getFeedbackAdminIds(): Promise<number[]> {
  const list = configuredAdmins();
  if (adminListEmpty(list)) {
    const owner = await prisma.gnucash_web_users.findFirst({ orderBy: { id: 'asc' }, select: { id: true } });
    return owner ? [owner.id] : [];
  }
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM gnucash_web_users
    WHERE id = ANY(${list.ids}::int[])
       OR lower(username) = ANY(${list.names}::text[])
       OR lower(coalesce(email, '')) = ANY(${list.emails}::text[])
  `;
  return rows.map((row) => row.id);
}

export async function isFeedbackAdmin(userId: number): Promise<boolean> {
  return (await getFeedbackAdminIds()).includes(userId);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export function appVersion(): string {
  const revision = (process.env.APP_REVISION ?? '').slice(0, 7);
  return revision ? `${packageJson.version} (${revision})` : packageJson.version;
}

export async function countRecentFeedback(userId: number): Promise<number> {
  await ensureFeedbackTable();
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) AS count FROM gnucash_web_feedback
    WHERE user_id = ${userId}
      AND created_at > now() - make_interval(mins => ${FEEDBACK_RATE_WINDOW_MINUTES}::int)
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function createFeedback(userId: number, input: ValidFeedback): Promise<StoredFeedback> {
  await ensureFeedbackTable();
  const rows = await prisma.$queryRaw<FeedbackRow[]>`
    INSERT INTO gnucash_web_feedback AS f (user_id, kind, body, route, context, app_version)
    VALUES (${userId}, ${input.kind}, ${input.body}, ${input.route},
            ${JSON.stringify(input.context)}::jsonb, ${appVersion()})
    RETURNING ${COLUMNS}
  `;
  const item = toStored(rows[0]);

  // The text is the valuable part: a screenshot that fails to store is
  // logged and dropped rather than failing the submission.
  if (input.screenshot) {
    const key = `feedback/${userId}/${item.id}.${screenshotExt(input.screenshot.contentType)}`;
    try {
      const storage = await getStorageBackend();
      await storage.put(key, input.screenshot.data, input.screenshot.contentType);
      await prisma.$executeRaw`
        UPDATE gnucash_web_feedback SET screenshot_key = ${key}, updated_at = now() WHERE id = ${item.id}
      `;
      item.screenshot_key = key;
      item.has_screenshot = true;
    } catch (error) {
      console.warn(`Feedback ${item.id}: failed to store screenshot:`, error);
    }
  }
  return item;
}

export async function getFeedback(id: number): Promise<StoredFeedback | null> {
  await ensureFeedbackTable();
  const rows = await prisma.$queryRaw<FeedbackRow[]>`
    SELECT ${COLUMNS} FROM gnucash_web_feedback f WHERE f.id = ${id}
  `;
  return rows[0] ? toStored(rows[0]) : null;
}

/** A user's own submissions, newest first. */
export async function listUserFeedback(userId: number, limit = 100): Promise<StoredFeedback[]> {
  await ensureFeedbackTable();
  const rows = await prisma.$queryRaw<FeedbackRow[]>`
    SELECT ${COLUMNS} FROM gnucash_web_feedback f
    WHERE f.user_id = ${userId}
    ORDER BY f.created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(toStored);
}

/** The operator inbox: every submission (optionally one status) with the submitter. */
export async function listAllFeedback(status: FeedbackStatus | null, limit = 500): Promise<StoredFeedback[]> {
  await ensureFeedbackTable();
  const rows = await prisma.$queryRaw<FeedbackRow[]>`
    SELECT ${COLUMNS},
           coalesce(nullif(u.display_name, ''), u.username) AS user_name,
           coalesce(u.email, '') AS user_email
    FROM gnucash_web_feedback f
    JOIN gnucash_web_users u ON u.id = f.user_id
    WHERE (${status ?? ''}::text = '' OR f.status = ${status ?? ''}::text)
    ORDER BY f.created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(toStored);
}

export async function feedbackStatusCounts(): Promise<Record<FeedbackStatus, number>> {
  await ensureFeedbackTable();
  const rows = await prisma.$queryRaw<Array<{ status: FeedbackStatus; count: bigint }>>`
    SELECT status, count(*) AS count FROM gnucash_web_feedback GROUP BY status
  `;
  const out = Object.fromEntries(FEEDBACK_STATUSES.map((s) => [s, 0])) as Record<FeedbackStatus, number>;
  for (const row of rows) out[row.status] = Number(row.count);
  return out;
}

/**
 * Sets status and/or the operator note. Moving into a closed status
 * (done/wontfix) stamps resolved_at and re-arms the submitter's one-time
 * notice; reopening clears both.
 */
export async function updateFeedbackTriage(
  id: number,
  patch: { status?: FeedbackStatus; adminNote?: string },
): Promise<StoredFeedback | null> {
  await ensureFeedbackTable();
  const status = patch.status ?? null;
  const note = patch.adminNote ?? null;
  const closed = FEEDBACK_CLOSED_STATUSES;
  const rows = await prisma.$queryRaw<FeedbackRow[]>`
    UPDATE gnucash_web_feedback AS f SET
      status = coalesce(${status}::text, f.status),
      admin_note = coalesce(${note}::text, f.admin_note),
      resolved_at = CASE
        WHEN coalesce(${status}::text, f.status) = ANY(${closed}::text[]) AND NOT (f.status = ANY(${closed}::text[])) THEN now()
        WHEN NOT (coalesce(${status}::text, f.status) = ANY(${closed}::text[])) THEN NULL
        ELSE f.resolved_at END,
      resolution_seen_at = CASE
        WHEN coalesce(${status}::text, f.status) = ANY(${closed}::text[]) AND NOT (f.status = ANY(${closed}::text[])) THEN NULL
        WHEN NOT (coalesce(${status}::text, f.status) = ANY(${closed}::text[])) THEN NULL
        ELSE f.resolution_seen_at END,
      updated_at = now()
    WHERE f.id = ${id}
    RETURNING ${COLUMNS}
  `;
  return rows[0] ? toStored(rows[0]) : null;
}

/** Acknowledges the "your report was closed" notice. ids empty = all of them. */
export async function markFeedbackResolutionSeen(userId: number, ids: number[]): Promise<void> {
  await ensureFeedbackTable();
  await prisma.$executeRaw`
    UPDATE gnucash_web_feedback SET resolution_seen_at = now()
    WHERE user_id = ${userId}
      AND resolved_at IS NOT NULL AND resolution_seen_at IS NULL
      AND (cardinality(${ids}::int[]) = 0 OR id = ANY(${ids}::int[]))
  `;
}

export async function readFeedbackScreenshot(item: StoredFeedback): Promise<{ data: Buffer; contentType: string } | null> {
  if (!item.screenshot_key) return null;
  try {
    const data = await (await getStorageBackend()).get(item.screenshot_key);
    const contentType = sniffImageType(data);
    return contentType ? { data, contentType } : null;
  } catch (error) {
    console.warn(`Feedback ${item.id}: failed to read screenshot:`, error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Operator push
// ---------------------------------------------------------------------------

/** The operator push: who, what kind, where, and the first part of the text. */
export function formatFeedbackNotification(
  item: Pick<FeedbackItem, 'id' | 'kind' | 'body' | 'route' | 'has_screenshot'>,
  who: string,
): { title: string; message: string } {
  const label = FEEDBACK_KIND_LABELS[item.kind] ?? 'Feedback';
  const title = item.kind === 'data'
    ? `${product.brand}: ${label} (${who})`
    : `${product.brand} ${item.kind === 'other' ? 'feedback' : label.toLowerCase()} from ${who}`;
  const chars = [...item.body];
  const lines = [chars.length > 400 ? `${chars.slice(0, 400).join('')}…` : item.body];
  if (item.route) lines.push(`Page: ${item.route}`);
  if (item.has_screenshot) lines.push('(screenshot attached)');
  return { title: title.slice(0, 255), message: lines.join('\n') };
}

/**
 * Tells every operator about a submission: an in-app notification (which
 * fans out to their email and webhooks per their settings) and, when
 * FEEDBACK_NTFY_URL is set, a direct ntfy push. Detached from the request so
 * a slow push never delays the submitter; failures are only logged.
 */
export function notifyFeedbackAdmins(item: StoredFeedback, submitter: { id: number; username: string }): void {
  void (async () => {
    try {
      const adminIds = await getFeedbackAdminIds();
      const user = await prisma.gnucash_web_users.findUnique({
        where: { id: submitter.id },
        select: { display_name: true, username: true },
      });
      const who = user?.display_name || user?.username || submitter.username || 'a user';
      const { title, message } = formatFeedbackNotification(item, who);
      const href = `/admin/feedback#${item.id}`;

      for (const adminId of adminIds) {
        // Your own report doesn't need to ping you in-app.
        if (adminId === submitter.id) continue;
        await createNotification({
          userId: adminId,
          type: 'feedback',
          severity: item.kind === 'bug' || item.kind === 'data' ? 'warning' : 'info',
          title,
          message,
          href,
          source: 'feedback',
          sourceId: String(item.id),
        }).catch((error) => console.warn(`Feedback ${item.id}: in-app notify failed:`, error));
      }

      const ntfyUrl = process.env.FEEDBACK_NTFY_URL?.trim();
      if (ntfyUrl) {
        const base = (process.env.APP_BASE_URL || process.env.NEXTAUTH_URL || '').trim().replace(/\/+$/, '');
        const headers: Record<string, string> = {
          // HTTP headers are Latin-1; ntfy decodes RFC 2047 encoded words.
          Title: `=?UTF-8?B?${Buffer.from(title).toString('base64')}?=`,
          Tags: item.kind === 'bug' ? 'bug' : item.kind === 'data' ? 'warning' : 'speech_balloon',
        };
        if (base) headers.Click = `${base}${href}`;
        const token = process.env.FEEDBACK_NTFY_TOKEN?.trim();
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(ntfyUrl, {
          method: 'POST',
          headers,
          body: message,
          redirect: 'manual',
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) console.warn(`Feedback ${item.id}: ntfy push returned ${res.status}`);
      }
    } catch (error) {
      console.warn(`Feedback ${item.id}: notify failed:`, error);
    }
  })();
}
