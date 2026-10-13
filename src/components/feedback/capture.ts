// Screenshots for the feedback dialog, ported from pdqr. Three ways in, best
// first:
//
//  1. Tab capture (Screen Capture API, getDisplayMedia with preferCurrentTab):
//     the browser's own pixels of this tab — exact, including charts,
//     scrolled tables and the sidebar. Chromium asks once ("Allow this tab to
//     be shared?"); it needs a secure context (https or localhost), so a
//     plain-http LAN install falls through to 2.
//  2. Page render (html-to-image, lazy-loaded): re-draws the app shell from
//     the DOM, no prompt. A DOM clone starts every scroll pane at scroll 0,
//     so each scrolled pane's children are shifted by its scroll offset for
//     the duration of the render, which puts the rows the person saw where
//     they saw them. Ledgers and the account tree run to 10k+ nodes, so
//     subtrees wholly off-screen are pruned (the clone keeps each element's
//     computed size, so layout is unchanged) — seconds instead of minutes.
//  3. Paste (Win+Shift+S, then Ctrl+V) or attach an image file.
//
// Everything ends as a data URL no larger than MAX_EDGE on its long side.

/** Longest edge of a stored screenshot (far under the 5 MB cap while table text stays readable). */
export const MAX_EDGE = 2400;
const JPEG_QUALITY = 0.86;
/** A page render that runs longer than this gives up so the dialog comes back. */
const RENDER_TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

export type ShotSource = 'tab' | 'page' | 'paste' | 'file';

/** Draws (a region of) an image source into a JPEG data URL capped at MAX_EDGE. */
export function toJpeg(source: CanvasImageSource, width: number, height: number, sx = 0, sy = 0): string {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(width * scale));
  out.height = Math.max(1, Math.round(height * scale));
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#0c1322';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, sx, sy, width, height, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', JPEG_QUALITY);
}

/** True when the browser can capture this tab (Screen Capture API in a secure context). */
export function canCaptureTab(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function'
  );
}

/** Thrown when the person dismissed the browser's share prompt. */
export class CaptureCancelled extends Error {}

/**
 * One frame of this tab via getDisplayMedia. The caller hides its own dialog
 * first; the browser's prompt is its own UI and is not in the frame.
 */
export async function captureTab(): Promise<string> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', frameRate: 5 },
      audio: false,
      // Chromium hints (not in the TS lib yet): offer this tab, nothing else.
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'exclude',
    } as DisplayMediaStreamOptions);
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')) {
      throw new CaptureCancelled('cancelled');
    }
    throw e;
  }
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    // The "sharing this tab" bar re-lays the page out; let it settle and a
    // fresh frame arrive before grabbing one.
    await sleep(400);
    await nextFrame();
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new Error('no video frame');
    return toJpeg(video, w, h);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

let fontCSS: Promise<string> | null = null;

/**
 * Renders the app shell from the DOM (no prompt). Elements marked
 * data-feedback-ignore (the dialog, overlays) are left out.
 */
export async function capturePage(): Promise<string> {
  const target = document.querySelector<HTMLElement>('[data-feedback-root]') ?? document.body;
  const { toCanvas, getFontEmbedCSS } = await import('html-to-image');
  // Web fonts are embedded once per page load (the slow part of a render).
  // An empty result would switch embedding off entirely (serif text), so it
  // falls back to the library's own per-render embedding instead.
  fontCSS ??= getFontEmbedCSS(target).catch(() => '');
  const fontEmbedCSS = (await fontCSS) || undefined;
  // Measured before any pane is shifted: the shift moves real elements.
  const offscreen = offscreenElements(target);
  const restore = shiftScrolledPanes(target);
  try {
    await nextFrame();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    const render = toCanvas(target, {
      pixelRatio,
      cacheBust: false,
      fontEmbedCSS,
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      width: target.clientWidth,
      height: target.clientHeight,
      filter: (node) => {
        if (node instanceof HTMLElement && node.dataset.feedbackIgnore !== undefined) return false;
        const parent = (node as Node).parentElement;
        return !(parent && offscreen.has(parent));
      },
    });
    const timeout = new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error('page render timed out')), RENDER_TIMEOUT_MS),
    );
    const canvas = await Promise.race([render, timeout]);
    return toJpeg(canvas, canvas.width, canvas.height);
  } finally {
    restore();
  }
}

/** Elements wholly outside the viewport; their descendants are not cloned. */
function offscreenElements(root: HTMLElement): WeakSet<Element> {
  const out = new WeakSet<Element>();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  root.querySelectorAll('*').forEach((el) => {
    const box = el.getBoundingClientRect();
    // display:contents and the like have no box of their own: never prune.
    if (box.width === 0 && box.height === 0) return;
    if (box.bottom < 0 || box.top > vh || box.right < 0 || box.left > vw) out.add(el);
  });
  return out;
}

/**
 * For every scrolled element under root, translates its children by the
 * scroll offset (the clone html-to-image renders starts each pane at scroll
 * 0, so the children move instead). Returns the undo.
 */
function shiftScrolledPanes(root: HTMLElement): () => void {
  const undo: (() => void)[] = [];
  const panes: HTMLElement[] = [];
  if (root.scrollTop || root.scrollLeft) panes.push(root);
  root.querySelectorAll<HTMLElement>('*').forEach((el) => {
    if (el.scrollTop || el.scrollLeft) panes.push(el);
  });
  for (const pane of panes) {
    const dx = pane.scrollLeft;
    const dy = pane.scrollTop;
    for (const child of Array.from(pane.children)) {
      if (!(child instanceof HTMLElement || child instanceof SVGElement)) continue;
      const style = child.style;
      const before = style.transform;
      style.transform = `translate(${-dx}px, ${-dy}px)${before ? ` ${before}` : ''}`;
      undo.push(() => {
        style.transform = before;
      });
    }
  }
  return () => undo.forEach((f) => f());
}

/** Reads a pasted / attached image; small PNG/JPEG/WebP files are kept as they are (lossless text), others re-encoded. */
export function imageFileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const keep =
          ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) &&
          file.size <= 2 * 1024 * 1024 &&
          Math.max(w, h) <= MAX_EDGE;
        if (keep) {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('unreadable file'));
          reader.readAsDataURL(file);
        } else {
          resolve(toJpeg(img, w, h));
        }
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

/** A highlight box in image fractions (0..1), drawn by the person on the preview. */
export interface Mark {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Normalizes two drag points (image fractions) into a box. */
export function markFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Mark {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** Burns the highlight boxes into the screenshot (red outline, faint fill). */
export function applyMarks(dataUrl: string, marks: Mark[]): Promise<string> {
  if (!marks.length) return Promise.resolve(dataUrl);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('canvas unavailable');
        ctx.drawImage(img, 0, 0);
        const line = Math.max(2, Math.round(Math.max(w, h) / 500));
        for (const m of marks) {
          const x = m.x * w;
          const y = m.y * h;
          const mw = m.w * w;
          const mh = m.h * h;
          ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
          ctx.fillRect(x, y, mw, mh);
          ctx.lineWidth = line;
          ctx.strokeStyle = '#ef4444';
          ctx.strokeRect(x, y, mw, mh);
        }
        const png = dataUrl.startsWith('data:image/png');
        resolve(
          png && dataUrl.length < 2.5 * 1024 * 1024
            ? c.toDataURL('image/png')
            : c.toDataURL('image/jpeg', JPEG_QUALITY),
        );
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('screenshot unreadable'));
    img.src = dataUrl;
  });
}
