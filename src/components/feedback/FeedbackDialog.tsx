'use client';

import { useEffect, useRef, useState, type ClipboardEvent } from 'react';

import { ErrorLiveRegion } from '@/components/a11y/LiveRegion';
import { Modal } from '@/components/ui/Modal';
import { TEXTAREA } from '@/components/ui/form';
import {
  buildFeedbackContext,
  currentFeedbackEnvironment,
  dataURLBytes,
  feedbackAge,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_KINDS,
  FEEDBACK_MAX_BODY,
  FEEDBACK_MAX_SCREENSHOT_BYTES,
  FEEDBACK_STATUS_LABELS,
  type FeedbackItem,
  type FeedbackKind,
} from '@/lib/feedback';

/** Longest edge of a stored screenshot; keeps uploads far under the 5 MB cap. */
const MAX_SHOT_EDGE = 1600;

/** Re-encodes an image/canvas region as a JPEG no larger than MAX_SHOT_EDGE on its long side. */
function toJpeg(source: HTMLCanvasElement | HTMLImageElement, sx = 0, sy = 0, sw?: number, sh?: number): string {
  const width = sw ?? source.width;
  const height = sh ?? source.height;
  const scale = Math.min(1, MAX_SHOT_EDGE / Math.max(width, height));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(width * scale));
  out.height = Math.max(1, Math.round(height * scale));
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#0c1322';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, sx, sy, width, height, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.82);
}

/** A capture that runs longer than this gives up so the dialog comes back. */
const CAPTURE_TIMEOUT_MS = 20_000;

/**
 * Captures what is visible of the page content (sidebar and top bar left
 * out). The content wrapper sits inside the scrolling <main>, so it is
 * rendered and cropped to the part inside the viewport.
 *
 * Ledgers and the account tree run to 10k+ nodes, and cloning every one
 * takes minutes. The clone carries each element's computed width/height,
 * so an element wholly outside the viewport is kept (holding its space)
 * but its descendants are skipped — the visible region lays out the same
 * and only on-screen subtrees pay the cloning cost.
 */
async function captureVisiblePage(): Promise<string> {
  const target = document.querySelector<HTMLElement>('[data-feedback-capture]') ?? document.body;
  const clip = (target.closest('main') ?? document.documentElement).getBoundingClientRect();
  const { toCanvas } = await import('html-to-image');
  const rect = target.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  const viewTop = Math.max(clip.top, 0);
  const viewBottom = Math.min(clip.bottom, window.innerHeight);
  const offscreen = new WeakMap<Element, boolean>();
  const isOffscreen = (element: Element): boolean => {
    let hidden = offscreen.get(element);
    if (hidden === undefined) {
      const box = element.getBoundingClientRect();
      // display:contents and the like have no box of their own: never prune.
      hidden = (box.width > 0 || box.height > 0) && (box.bottom < viewTop || box.top > viewBottom);
      offscreen.set(element, hidden);
    }
    return hidden;
  };
  const canvas = await toCanvas(target, {
    pixelRatio,
    cacheBust: false,
    backgroundColor: getComputedStyle(document.body).backgroundColor,
    filter: (node) => {
      if (node instanceof HTMLElement && node.dataset.feedbackIgnore !== undefined) return false;
      const parent = (node as Node).parentElement;
      return !(parent && parent !== target && isOffscreen(parent));
    },
  });
  const top = Math.max(rect.top, clip.top, 0);
  const bottom = Math.min(rect.bottom, clip.bottom, window.innerHeight);
  const left = Math.max(rect.left, clip.left, 0);
  const right = Math.min(rect.right, clip.right, window.innerWidth);
  return toJpeg(
    canvas,
    Math.round((left - rect.left) * pixelRatio),
    Math.round((top - rect.top) * pixelRatio),
    Math.max(1, Math.round((right - left) * pixelRatio)),
    Math.max(1, Math.round((bottom - top) * pixelRatio)),
  );
}

/** Reads an image file or pasted blob into a size-capped JPEG data URL. */
function imageFileToDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        resolve(toJpeg(img, 0, 0, img.naturalWidth, img.naturalHeight));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('not an image'));
    };
    img.src = url;
  });
}

const STATUS_COLOR: Record<string, string> = {
  new: 'text-foreground-secondary',
  triaged: 'text-warning',
  done: 'text-success',
  wontfix: 'text-foreground-muted',
};

const BUTTON_QUIET =
  'rounded-md border border-border bg-background-tertiary px-3 py-1.5 text-xs font-medium text-foreground-secondary transition-colors hover:border-border-hover hover:text-foreground disabled:opacity-50';
const BUTTON_PRIMARY =
  'rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50';

function History() {
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch('/api/feedback')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { items: FeedbackItem[] }) => setItems(data.items ?? []))
      .catch(() => setFailed(true));
  }, []);
  if (failed) return <p className="py-6 text-center text-sm text-foreground-muted">Couldn&apos;t load your reports.</p>;
  if (!items) return <p className="py-6 text-center text-sm text-foreground-muted">Loading…</p>;
  if (!items.length) {
    return <p className="py-6 text-center text-sm text-foreground-muted">You haven&apos;t sent any feedback yet.</p>;
  }
  return (
    <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
      {items.map((item) => (
        <li key={item.id} className="rounded-lg border border-border bg-background-tertiary px-3 py-2">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="font-semibold uppercase tracking-wider text-foreground-muted">
              {FEEDBACK_KIND_LABELS[item.kind]}
            </span>
            <span className={`font-medium ${STATUS_COLOR[item.status]}`}>
              {FEEDBACK_STATUS_LABELS[item.status]} · {feedbackAge(item.created_at)}
            </span>
          </div>
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-foreground">{item.body}</p>
          {item.admin_note && (
            <p className="mt-1.5 border-l-2 border-primary/50 pl-2 text-xs text-foreground-secondary">{item.admin_note}</p>
          )}
          {item.has_screenshot && (
            <a
              href={`/api/feedback/${item.id}/screenshot`}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-[11px] text-primary hover:underline"
            >
              Screenshot
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

export function FeedbackDialog({
  open,
  initialKind,
  activeBookGuid,
  onClose,
}: {
  open: boolean;
  initialKind: FeedbackKind;
  activeBookGuid?: string | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'send' | 'history'>('send');
  const [kind, setKind] = useState<FeedbackKind>(initialKind);
  const [body, setBody] = useState('');
  const [shot, setShot] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Captured once per opening, so the route is the page the person was on.
  const routeRef = useRef('');

  useEffect(() => {
    if (!open) return;
    routeRef.current = window.location.pathname + window.location.search;
    setTab('send');
    setKind(initialKind);
    setError(null);
    setSent(false);
    const timer = window.setTimeout(() => textRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, initialKind]);

  const setScreenshot = (dataURL: string) => {
    if (dataURLBytes(dataURL) > FEEDBACK_MAX_SCREENSHOT_BYTES) {
      setError('That image is too large (5 MB max).');
      return;
    }
    setError(null);
    setShot(dataURL);
  };

  const capture = async () => {
    // The modal is hidden (not unmounted: this component keeps the draft)
    // while the page is cloned, so it never appears in its own screenshot.
    setCapturing(true);
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    try {
      const timeout = new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error('capture timed out')), CAPTURE_TIMEOUT_MS),
      );
      setScreenshot(await Promise.race([captureVisiblePage(), timeout]));
    } catch {
      setError("Couldn't capture this page. Attach or paste a screenshot instead.");
    } finally {
      setCapturing(false);
    }
  };

  const attach = async (file: Blob | null | undefined) => {
    if (!file) return;
    try {
      setScreenshot(await imageFileToDataURL(file));
    } catch {
      setError("That file isn't an image Folio can read.");
    }
  };

  const onPaste = (event: ClipboardEvent) => {
    const image = Array.from(event.clipboardData.items).find((item) => item.type.startsWith('image/'));
    if (image) {
      event.preventDefault();
      void attach(image.getAsFile());
    }
  };

  const submit = async () => {
    if (busy || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const env = currentFeedbackEnvironment(activeBookGuid);
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          body: body.trim(),
          route: routeRef.current,
          context: buildFeedbackContext({ ...env, pathname: routeRef.current.split('?')[0] }),
          screenshot: shot ?? undefined,
        }),
      });
      if (!res.ok) {
        setError(
          res.status === 429
            ? "You've sent a lot of feedback in the last hour. Try again a bit later."
            : "Couldn't send your feedback. Check your connection and try again.",
        );
        return;
      }
      setSent(true);
      setBody('');
      setShot(null);
    } catch {
      setError("Couldn't send your feedback. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const hint = FEEDBACK_KINDS.find((k) => k.id === kind)?.hint;

  return (
    <Modal isOpen={open && !capturing} onClose={onClose} title="Feedback" size="md">
      <div className="space-y-4 p-4 sm:p-6" onPaste={onPaste}>
        <div className="flex gap-1 border-b border-border" role="tablist" aria-label="Feedback views">
          {(['send', 'history'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-foreground-secondary hover:text-foreground'
              }`}
            >
              {id === 'send' ? 'Send' : 'Your reports'}
            </button>
          ))}
        </div>

        <ErrorLiveRegion message={tab === 'send' && !sent ? error : null} />

        {tab === 'history' ? (
          <History />
        ) : sent ? (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm font-medium text-foreground">Thanks — your feedback was sent.</p>
            <p className="text-xs text-foreground-secondary">You&apos;ll see a note here when it&apos;s been looked at.</p>
            <div className="flex justify-center gap-2">
              <button type="button" onClick={() => setSent(false)} className={BUTTON_QUIET}>
                Send more
              </button>
              <button type="button" onClick={onClose} className={BUTTON_PRIMARY}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Feedback type">
              {FEEDBACK_KINDS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={kind === option.id}
                  onClick={() => setKind(option.id)}
                  className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors ${
                    kind === option.id
                      ? 'border-primary/50 bg-primary-light text-primary'
                      : 'border-border bg-background-tertiary text-foreground-secondary hover:text-foreground'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {hint && <p className="text-[11px] text-foreground-muted">{hint}</p>}
            <textarea
              ref={textRef}
              value={body}
              onChange={(event) => setBody(event.target.value.slice(0, FEEDBACK_MAX_BODY))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void submit();
                }
              }}
              rows={5}
              placeholder={
                kind === 'data'
                  ? 'What looks wrong, and what did you expect? (e.g. checking balance is $40 higher than the bank)'
                  : 'What happened, or what would you like?'
              }
              aria-label="Feedback"
              className={TEXTAREA}
            />

            {shot ? (
              <div className="relative overflow-hidden rounded-lg border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
                <img src={shot} alt="Screenshot to send" className="max-h-40 w-full object-cover object-top" />
                <button
                  type="button"
                  onClick={() => setShot(null)}
                  aria-label="Remove screenshot"
                  className="absolute right-1.5 top-1.5 rounded-md bg-black/60 p-1 text-white hover:bg-black/80"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <button type="button" onClick={() => void capture()} disabled={capturing} className={BUTTON_QUIET}>
                  {capturing ? 'Capturing…' : 'Capture this page'}
                </button>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="rounded-md px-2 py-1.5 font-medium text-foreground-secondary hover:text-foreground"
                >
                  Attach image
                </button>
                <span className="text-foreground-muted">or paste one</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  aria-label="Attach screenshot"
                  onChange={(event) => {
                    void attach(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
              </div>
            )}

            {error && <p className="text-xs text-error">{error}</p>}

            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-[11px] leading-snug text-foreground-muted">
                Sent with this page&apos;s address, your screen size and browser.
              </p>
              <button type="submit" disabled={busy || !body.trim()} className={`shrink-0 ${BUTTON_PRIMARY}`}>
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
