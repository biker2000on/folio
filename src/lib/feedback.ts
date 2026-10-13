// In-app feedback: the kinds a person can file, the triage statuses an
// operator sets, and the page context captured with every submission so a
// report arrives pointing at the exact page and record.
//
// Client-safe: no server imports. The server side lives in
// src/lib/services/feedback.service.ts.

export type FeedbackKind = 'bug' | 'idea' | 'data' | 'other';
export type FeedbackStatus = 'new' | 'triaged' | 'done' | 'wontfix';

export interface FeedbackItem {
  id: number;
  user_id: number;
  /** Operator inbox only. */
  user_name?: string;
  user_email?: string;
  kind: FeedbackKind;
  body: string;
  route: string;
  context: Record<string, unknown>;
  app_version: string;
  has_screenshot: boolean;
  status: FeedbackStatus;
  admin_note: string;
  resolved_at: string | null;
  resolution_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedbackSubmission {
  kind: FeedbackKind;
  body: string;
  route: string;
  context: Record<string, unknown>;
  /** Optional data URL (PNG / JPEG / WebP, at most 5 MB decoded). */
  screenshot?: string;
}

export const FEEDBACK_KIND_IDS: FeedbackKind[] = ['bug', 'idea', 'data', 'other'];
export const FEEDBACK_STATUSES: FeedbackStatus[] = ['new', 'triaged', 'done', 'wontfix'];
export const FEEDBACK_CLOSED_STATUSES: FeedbackStatus[] = ['done', 'wontfix'];

export const FEEDBACK_KINDS: { id: FeedbackKind; label: string; hint: string }[] = [
  { id: 'bug', label: 'Bug', hint: 'Something broke or behaved oddly' },
  { id: 'data', label: 'Data looks wrong', hint: "A balance, report or transaction doesn't match reality" },
  { id: 'idea', label: 'Idea', hint: "Something you'd like Folio to do" },
  { id: 'other', label: 'Other', hint: 'Anything else' },
];

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  bug: 'Bug',
  data: 'Data looks wrong',
  idea: 'Idea',
  other: 'Other',
};

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: 'New',
  triaged: 'Triaged',
  done: 'Done',
  wontfix: "Won't fix",
};

export const FEEDBACK_MAX_BODY = 5000;
export const FEEDBACK_MAX_ROUTE = 500;
/** Serialized context limit the API enforces. */
export const FEEDBACK_MAX_CONTEXT_BYTES = 8 * 1024;
/** Decoded screenshot limit the API enforces. */
export const FEEDBACK_MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

/** Window event that opens the feedback dialog from anywhere. */
export const OPEN_FEEDBACK_EVENT = 'open-feedback';

/** Path segments whose next segment is a record id worth pulling out. */
const ENTITY_SEGMENTS: Record<string, string> = {
  accounts: 'account_guid',
  budgets: 'budget_guid',
  books: 'book_guid',
  transactions: 'transaction_guid',
  invoices: 'invoice_id',
  bills: 'bill_id',
  customers: 'customer_id',
  vendors: 'vendor_id',
  employees: 'employee_id',
  'expense-reports': 'expense_report_id',
  'scheduled-transactions': 'scheduled_transaction_guid',
  goals: 'goal_id',
  assets: 'asset_id',
};

/** Ids named in the path, e.g. /accounts/ab12… → { account_guid: "ab12…" }. */
export function routeEntities(pathname: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = pathname.split('/').filter(Boolean);
  parts.forEach((part, index) => {
    const key = ENTITY_SEGMENTS[part];
    const next = parts[index + 1];
    if (key && next && /^[\w-]+$/.test(next) && /\d/.test(next)) out[key] = next;
  });
  return out;
}

export interface FeedbackEnvironment {
  pathname: string;
  search: string;
  title: string;
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  userAgent: string;
  theme: string | null;
  timezone: string;
  standalone: boolean;
  activeBookGuid?: string | null;
}

/** The structured context sent with a submission (kept well under 8 KB). */
export function buildFeedbackContext(env: FeedbackEnvironment): Record<string, unknown> {
  const context: Record<string, unknown> = {
    page_title: env.title.slice(0, 200),
    query: env.search.slice(0, 500),
    viewport: `${env.viewport.width}x${env.viewport.height}`,
    device_pixel_ratio: env.devicePixelRatio,
    user_agent: env.userAgent.slice(0, 400),
    theme: env.theme,
    timezone: env.timezone,
    installed_app: env.standalone,
    ...routeEntities(env.pathname),
  };
  if (env.activeBookGuid) context.active_book_guid = env.activeBookGuid;
  return context;
}

/** Reads the live browser environment (client only). */
export function currentFeedbackEnvironment(activeBookGuid?: string | null): FeedbackEnvironment {
  let timezone = '';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* older engines */
  }
  const root = document.documentElement;
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent,
    theme: root.getAttribute('data-theme') ?? (root.classList.contains('dark') ? 'dark' : null),
    timezone,
    standalone: window.matchMedia?.('(display-mode: standalone)').matches ?? false,
    activeBookGuid,
  };
}

/** Closed items whose "resolved" notice the submitter has not dismissed. */
export function unseenResolved(items: FeedbackItem[]): FeedbackItem[] {
  return items.filter((item) => item.resolved_at && !item.resolution_seen_at);
}

/** Approximate decoded size of a base64 data URL. */
export function dataURLBytes(dataURL: string): number {
  const payload = dataURL.slice(dataURL.indexOf(',') + 1);
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

/** "5m ago" style age for history rows and the inbox. */
export function feedbackAge(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
