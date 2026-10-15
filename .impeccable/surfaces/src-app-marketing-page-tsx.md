---
version: 1
slug: "src-app-marketing-page-tsx"
primary_target: "src/app/(marketing)/page.tsx"
related_targets: ["src/app/(marketing)/layout.tsx","src/app/(marketing)/features/page.tsx","src/app/(marketing)/features/[slug]/page.tsx"]
---

## Scope

Logged-out marketing surface: `src/app/(marketing)/` (layout, `/`, `/features`, `/features/[slug]`) and `src/components/marketing/`. Mode: **Persuade**. Build path: code-led (no image generation this session).

## Audience and action

Self-hosters evaluating Folio from GitHub (GnuCash users, homelab people). Primary action: deploy it — `/docs/getting-started` (header key keeps `data-testid="marketing-open-books"`). Secondary: source on GitHub, browse features. "Sign in" stays for existing instance users. Proof: the real feature registry counts, the true deployment topology (one Docker image + worker against your PostgreSQL, optional connectors), exact-fraction storage, GnuCash XML round-trip. No invented testimonials, user counts, or prices.

## Direction contract

THESIS: Folio is a desk instrument you own, not a service you rent: one appliance (one Docker image) whose keys are its six systems and whose amber screen reads your ledger. Refuses the category default of headline + app screenshot + equal feature cards.

OWN-WORLD: gunmetal chassis (#3d4248 on charcoal #171a1e), bone (#e6e2d9) and putty (#c6c2b8) keycaps with dye-sub mono legends and drawn corner icons, safety orange (#ff6a00) reserved for the single commit action per view, amber LCD (#ffc24d glow on #241a06) for live state, knurled aluminium knobs. Martian Mono for display and legends, Geist for running prose. Keys have real travel (layered shadow + :active press).

STORY: In one viewport the visitor sees Folio is a self-hosted ledger appliance, presses keys to see each system on the screen, and hits the orange DEPLOY key to read the getting-started guide.

FIRST VIEWPORT: Left 5/12: tracked mono headline "YOUR LEDGER. YOUR HARDWARE." over two-line Geist lede and two controls (orange DEPLOY key, putty VIEW SOURCE key). Right 7/12: the Folio instrument at large scale, amber LCD on top showing the active system's live readout (synthetic demo data, labeled DEMO), 2x3 keycap grid of the six systems, a knob scrubbing the LCD's period, status strip "1 IMAGE · YOUR POSTGRES · 0 CLOUD STORES". Spec strip beneath both.

FORM: design-canon-creator-hardware-bench (catalog challenger, chosen by the user over the rolled Recorder of Deeds); seed: none (unavailable). Signature interaction: pressing a keycap travels it down, lights it, and the LCD redraws that system's readout with a scanline wipe; knob drag/arrow keys scrub the readout. Motion grammar: key-travel snap, knob detents, LCD redraw; no scroll-entrance effects.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Raises carried from declined challengers

- One accent is both accent and control (orange = the action only).
- Every claim has a back panel: feature entries lead to their docs page.

## Unresolved

- Real photography / product renders: none available without image generation; instrument and screens are authored in code. Replace with real renders later if desired.
