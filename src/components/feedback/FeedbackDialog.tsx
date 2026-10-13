'use client';

import { useEffect, useRef, useState, type ClipboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

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
import {
  applyMarks,
  canCaptureTab,
  CaptureCancelled,
  captureTab,
  capturePage,
  imageFileToDataUrl,
  markFromPoints,
  type Mark,
  type ShotSource,
} from './capture';

const STATUS_COLOR: Record<string, string> = {
  new: 'text-foreground-secondary',
  triaged: 'text-warning',
  done: 'text-success',
  wontfix: 'text-foreground-muted',
};

const BUTTON_QUIET =
  'inline-flex items-center gap-1.5 rounded-md border border-border bg-background-tertiary px-3 py-1.5 text-xs font-medium text-foreground-secondary transition-colors hover:border-border-hover hover:text-foreground disabled:opacity-50';
const BUTTON_PRIMARY =
  'rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50';
const LINK_BUTTON = 'text-primary hover:underline';

/** A drag smaller than this share of the image is a click, not a highlight. */
const MIN_MARK_FRACTION = 1 / 100;

const X_ICON = (
  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

/** Screenshot preview: drag on it to draw red highlight boxes (image fractions). */
function ShotPreview({
  src,
  marks,
  onMarks,
  onRemove,
}: {
  src: string;
  marks: Mark[];
  onMarks: (marks: Mark[]) => void;
  onRemove: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Mark | null>(null);

  const at = (event: ReactPointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  return (
    <div className="space-y-1.5">
      <div className="relative inline-block max-w-full overflow-hidden rounded-md border border-border">
        <div
          ref={box}
          data-testid="feedback-shot"
          className="relative cursor-crosshair touch-none select-none"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            start.current = at(event);
            setDraft(null);
          }}
          onPointerMove={(event) => {
            if (start.current) setDraft(markFromPoints(start.current, at(event)));
          }}
          onPointerUp={(event) => {
            if (start.current) {
              const mark = markFromPoints(start.current, at(event));
              if (mark.w > MIN_MARK_FRACTION && mark.h > MIN_MARK_FRACTION) onMarks([...marks, mark]);
            }
            start.current = null;
            setDraft(null);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
          <img src={src} alt="Screenshot to send" draggable={false} className="block max-h-80 max-w-full" />
          {[...marks, ...(draft ? [draft] : [])].map((mark, i) => (
            <div
              key={i}
              className="pointer-events-none absolute border-2 border-red-500 bg-red-500/10"
              style={{
                left: `${mark.x * 100}%`,
                top: `${mark.y * 100}%`,
                width: `${mark.w * 100}%`,
                height: `${mark.h * 100}%`,
              }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove screenshot"
          className="absolute right-1.5 top-1.5 rounded-md bg-black/60 p-1 text-white hover:bg-black/80"
        >
          {X_ICON}
        </button>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-foreground-muted">
        <span>Drag on the screenshot to highlight what you mean.</span>
        {marks.length > 0 && (
          <>
            <button type="button" className={LINK_BUTTON} onClick={() => onMarks(marks.slice(0, -1))}>
              Undo
            </button>
            <button type="button" className={LINK_BUTTON} onClick={() => onMarks([])}>
              Clear
            </button>
          </>
        )}
      </div>
    </div>
  );
}

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
              {FEEDBACK_KIND_LABELS[item.kind]} · #{item.id}
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
  const [shotSource, setShotSource] = useState<ShotSource | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [capturing, setCapturing] = useState(false);
  // A DOM render takes a few seconds with the dialog hidden: say so.
  const [rendering, setRendering] = useState(false);
  // The browser did not share the tab (cancelled, or blocked): offer the DOM render.
  const [offerRender, setOfferRender] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
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
    setSent(null);
    const timer = window.setTimeout(() => textRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, initialKind]);

  const setScreenshot = (dataURL: string, source: ShotSource) => {
    if (dataURLBytes(dataURL) > FEEDBACK_MAX_SCREENSHOT_BYTES) {
      setError('That image is too large (5 MB max).');
      return;
    }
    setError(null);
    setShot(dataURL);
    setShotSource(source);
    setMarks([]);
  };

  const capture = async (mode: 'auto' | 'render' = 'auto') => {
    // The modal is hidden (not unmounted: this component keeps the draft)
    // while the page is captured, so it never appears in its own screenshot.
    setCapturing(true);
    setError(null);
    setOfferRender(false);
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    try {
      if (mode === 'auto' && canCaptureTab()) {
        try {
          setScreenshot(await captureTab(), 'tab');
          return;
        } catch (err) {
          if (err instanceof CaptureCancelled) {
            setOfferRender(true);
            return;
          }
          // Tab capture failed for another reason: render the page instead.
        }
      }
      setRendering(true);
      setScreenshot(await capturePage(), 'page');
    } catch {
      setError("Couldn't capture this page. Take a screenshot (Win+Shift+S) and paste it here instead.");
    } finally {
      setRendering(false);
      setCapturing(false);
    }
  };

  const attach = async (file: Blob | null | undefined, source: ShotSource) => {
    if (!file) return;
    try {
      setScreenshot(await imageFileToDataUrl(file), source);
    } catch {
      setError("That file isn't an image Folio can read.");
    }
  };

  const onPaste = (event: ClipboardEvent) => {
    const image = Array.from(event.clipboardData.items).find((item) => item.type.startsWith('image/'));
    if (image) {
      event.preventDefault();
      void attach(image.getAsFile(), 'paste');
    }
  };

  const canSend = !busy && !capturing && body.trim().length > 0;

  const submit = async () => {
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      const screenshot = shot ? await applyMarks(shot, marks) : undefined;
      if (screenshot && dataURLBytes(screenshot) > FEEDBACK_MAX_SCREENSHOT_BYTES) {
        setError('That screenshot is too large (5 MB max).');
        return;
      }
      const env = currentFeedbackEnvironment(activeBookGuid);
      const context = buildFeedbackContext({ ...env, pathname: routeRef.current.split('?')[0] });
      if (shot) {
        context.screenshot = shotSource;
        context.highlights = marks.length;
      }
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, body: body.trim(), route: routeRef.current, context, screenshot }),
      });
      if (!res.ok) {
        setError(
          res.status === 429
            ? "You've sent a lot of feedback in the last hour. Try again a bit later."
            : res.status === 413
              ? 'That screenshot is too large to send. Remove it or attach a smaller one.'
              : "Couldn't send your feedback. Check your connection and try again.",
        );
        return;
      }
      const created = (await res.json().catch(() => null)) as { id?: number } | null;
      setSent(created?.id ?? 0);
      setBody('');
      setShot(null);
      setMarks([]);
    } catch {
      setError("Couldn't send your feedback. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const hint = FEEDBACK_KINDS.find((k) => k.id === kind)?.hint;
  const tabCapture = canCaptureTab();

  return (
    <>
      {rendering && (
        <div
          data-feedback-ignore
          role="status"
          className="fixed bottom-4 left-1/2 z-[10000] -translate-x-1/2 rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-xs text-foreground-secondary shadow-lg"
        >
          Capturing the page…
        </div>
      )}
      <Modal isOpen={open && !capturing} onClose={onClose} title="Feedback" size="lg">
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

          <ErrorLiveRegion message={tab === 'send' && sent == null ? error : null} />

          {tab === 'history' ? (
            <History />
          ) : sent != null ? (
            <div className="space-y-3 py-6 text-center">
              <p className="text-sm font-medium text-foreground">
                Thanks — your feedback was sent{sent ? ` (#${sent})` : ''}.
              </p>
              <p className="text-xs text-foreground-secondary">
                You&apos;ll see the status under &ldquo;Your reports&rdquo;, and a note here when it&apos;s been handled.
              </p>
              <div className="flex justify-center gap-2">
                <button type="button" onClick={() => setSent(null)} className={BUTTON_QUIET}>
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
                <ShotPreview src={shot} marks={marks} onMarks={setMarks} onRemove={() => setShot(null)} />
              ) : (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button type="button" onClick={() => void capture()} disabled={capturing} className={BUTTON_QUIET}>
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8a2 2 0 0 1 2-2h1.5l1.5-2h6l1.5 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" />
                      <circle cx="12" cy="12.5" r="3.5" />
                    </svg>
                    {capturing ? 'Capturing…' : 'Capture this page'}
                  </button>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="rounded-md px-2 py-1.5 font-medium text-foreground-secondary hover:text-foreground"
                  >
                    Attach image
                  </button>
                  <span className="text-foreground-muted">or paste one (Win+Shift+S, then Ctrl+V)</span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
                    className="hidden"
                    aria-label="Attach screenshot"
                    onChange={(event) => {
                      void attach(event.target.files?.[0], 'file');
                      event.target.value = '';
                    }}
                  />
                </div>
              )}
              {!shot && tabCapture && !offerRender && (
                <p className="text-[11px] text-foreground-muted">
                  Your browser asks once to share this tab; only the picture is kept.
                </p>
              )}

              {offerRender && !shot && (
                <p className="text-xs text-foreground-secondary">
                  The browser didn&apos;t share this tab.{' '}
                  <button type="button" className={LINK_BUTTON} onClick={() => void capture('render')}>
                    Render the page instead
                  </button>{' '}
                  (no prompt; may differ slightly) or paste a screenshot.
                </p>
              )}

              {error && <p className="text-xs text-error">{error}</p>}

              <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-[11px] leading-snug text-foreground-muted">
                  Sent with this page&apos;s address, your screen size and browser. Ctrl+Enter sends.
                </p>
                <button type="submit" disabled={!canSend} className={`shrink-0 ${BUTTON_PRIMARY}`}>
                  {busy ? 'Sending…' : 'Send'}
                </button>
              </div>
            </form>
          )}
        </div>
      </Modal>
    </>
  );
}
