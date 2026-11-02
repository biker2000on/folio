# Accounts and ledger pages: impeccable audit and critique

**Date:** 2026-11-02
**Trigger:** in-app feedback #9: "header looks like shit and filter pane is too small. Also, too constrained width-wise. Should use impeccable to review this page and the ledger pages."
**Scope:** `/accounts` (`src/app/(main)/accounts/page.tsx`, `src/components/AccountHierarchy.tsx`, `src/components/ui/FilterBar.tsx`) and `/accounts/[guid]` (`src/app/(main)/accounts/[guid]/page.tsx`, `src/components/AccountLedger.tsx`, `src/components/InvestmentAccount.tsx`), plus the width rule in `src/components/Layout.tsx`.
**Status:** implemented the same day (owner: "YES to both" deviations, "implement everything"). See [Implementation](#implementation-2026-11-02) at the end.

Method: dual-agent critique (A: design review sub-agent · B: detector + browser-overlay sub-agent, run isolated), plus a technical audit in the parent session. Every recommendation is checked against `DESIGN.md`; where a fix needs a rule change it is marked **DEVIATION**.

## Evidence

All captures are from headless Chromium against the dev server (`localhost:3000`, dev DB, main book), in the dark theme, at 1440×900, 2560×1271 and 412×915 (mobile emulation).

- Bank ledger: Ally Interest Checking (`6d3744…`), default "This Year" range.
- Investment ledger: VTI (MUTUAL, `a4f07f…`). Captured once at the default "This Year" range, which has no transactions, and once at 2015-01-01 → 2026-12-31.

The screenshots show real balances and names, so they are **not** in the repo. They are in the session notes folder:
`C:\Users\biker\AppData\Roaming\Claude\side-session-notes\local_3b248967-7fc4-4088-913c-2e164460b588\impeccable-accounts-ledger-shots\`
That folder holds `accounts-{1440,2560,412}.png`, `bank-{1440,2560,412}.png`, `fund-1440.png`, `fundall-{1440,2560,412}-s1.png`, and `measurements*.json`.

Key measurements (DOM bounding boxes):

| Page @ viewport | Content column | Filter / search input | Table (box / scrollWidth ÷ clientWidth) | Notes |
|---|---|---|---|---|
| Accounts @1440 | 1152 px of 1184 available | **77 px** ("Filter a…") | 1038 / 1038 ÷ 1038 | Toolbar: 6 groups and 8 controls in one 44 px row |
| Accounts @2560 | **1152 px of 2304 available (50%)** | **77 px** | 1038 | Everything centred, with 576 px of empty space on each side |
| Accounts @412 | 412 | full width | **420 / 420 ÷ 354** | Balance columns clipped to "$1"; tree shows names only |
| Bank ledger @1440 | 1184 (unbounded) | 510 px | 1118 | About 53 px row pitch, 10 rows per screen |
| Bank ledger @2560 | **2304 (unbounded)** | 1630 px | **2238 px wide** | About 850 px of empty space between Description and Transfer; amounts about 1,500 px right of the date |
| Bank ledger @412 | 412 | — | cards | Header **260 px** tall; each transaction card about 270 px, so 2.5 per screen |
| VTI ledger @1440 (all dates) | 1184 | 335 px | **1286 / 1286 ÷ 1118** | 168 px horizontal overflow; Share Bal / Cost Basis columns cut off |
| VTI ledger @1440 (This Year) | 1184 | — | — | Table starts at **y = 965 on a 900 px viewport**; header says **Current Balance $0.00** while the KPI row says 705.9206 shares / $262,298.92 |

## Root causes of the three things the owner reported

1. **"Filter pane is too small."** `FilterBar` lays the desktop toolbar out as one `md:flex md:flex-wrap` row (`src/components/ui/FilterBar.tsx:31`). The filter input's wrapper is `flex-1` (`AccountHierarchy.tsx:1174`), which means `flex-basis: 0`. It therefore gets only the space its sibling controls leave over, and since they never wrap first, that comes to 77 px at every desktop width.
2. **"Too constrained width-wise."** `Layout.tsx` applies `max-w-6xl` (1152 px) to every page not on the `isFullWidthPage` list (`Layout.tsx:546`, rendered around line 1063). `/accounts/` matches the list, but `/accounts` itself does not. So Accounts is held to 1152 px, narrower even than DESIGN.md's own 1400 px maximum. The ledger has the opposite problem: it is fully unbounded and stretches to 2304 px at 2560.
3. **"Header looks like shit."** At 1440, about 254 px of stacked chrome sits above the first account row: page h1 + filler subtitle + date picker, then a second card heading with a decorative pill, then an 8-control toolbar. On the ledger the account name appears in **four** places:
   - the eyebrow breadcrumb
   - the h1
   - the colon path
   - for investments, the security card title as well

   It also carries a "LEDGER" badge that tells the user nothing.

---

## Scores

### Critique: Nielsen heuristics (Assessment A): **21 / 40, Acceptable**

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | VTI header shows "Current Balance $0.00" next to a 705.92-share KPI |
| 2 | Match to real world | 3 | GnuCash vocabulary is right; the "LEDGER" badge and the "Balance in commodity" column for USD accounts add nothing |
| 3 | User control and freedom | 3 | Esc goes back and filters clear; changing the FIFO cost method gives no feedback |
| 4 | Consistency and standards | 1 | Three hand-rolled input styles; 1152 px vs unbounded widths; two breadcrumbs; "New Transaction" appears twice on investment pages, in two styles |
| 5 | Error prevention | 2 | The FIFO/LIFO select saves to the account and swallows failure (`AccountLedger.tsx:2256` `catch {}`) |
| 6 | Recognition over recall | 2 | Row actions appear only on hover; reconcile state is a bare `N`/`Y` letter |
| 7 | Flexibility and efficiency | 3 | `/` to filter, Alt+R, the Columns menu, Edit Mode and keyboard row focus are real accelerators |
| 8 | Aesthetic and minimalist design | 1 | Frosted heavy-shadow panels, an IMPORTED chip on every row, a wall of green `$0.00` |
| 9 | Error recovery | 2 | "SimpleFIN sync failed" offers no action; error panels are bare text |
| 10 | Help and documentation | 2 | Contextual help link and `<Abbr>` exist; the toolbar controls are unexplained |

**Cognitive load: 6 of 8 checks fail (high).** Five decision points offer more than 4 options at once:
- Accounts toolbar: 8 controls, plus New Account above it
- Expand-to-depth select: 7 options
- Investment ledger toolbar: 9 controls
- Price chart: 7 periods plus 2 modes
- Mobile overflow menu: 5 items

On VTI, two date ranges are active at the same time: the page range and the chart's own "3M".

### Audit: technical health (parent session): **10 / 20, Acceptable**

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 2 | Toggles and the filter input have no accessible name; row actions are hover-only; native `title` gets through via `<Link>`; `--foreground-muted` labels measure 3.7–3.9:1 (S1) |
| 2 | Performance | 2 | Accounts renders the whole expanded tree: **2,325 interactive elements**, a 14,602 px table, no virtualization. `backdrop-blur-xl` sits on large scrolling panels (8× in `InvestmentAccount.tsx`) |
| 3 | Theming | 2 | The investment chart hard-codes neutral-palette hex (`#737373`, `#404040`, `#171717`, `#a3a3a3`) and a cyan `#06b6d4` instead of `CHART_THEME`, so it is wrong in the light theme |
| 4 | Responsive | 2 | Accounts clips balances at 412; the investment table overflows at 1440; the ledger is unbounded at 2560 |
| 5 | Implementation integrity | 2 | Off-system decoration (glass, `shadow-2xl`, `rounded-full` pill), hand-rolled inputs, KPI cards that lead nowhere, a gap in the `title=` guard test |

### Deterministic scan (Assessment B)

The CLI found 1 issue in 25 files, a false positive. The browser overlay found 27 issues on `/accounts`, 135 on the bank ledger and 39 on the investment ledger. Almost all of them are four repeated patterns: sub-12 px labels, `--foreground-muted` contrast, tight leading in wrapped cells, and the 9 px IMPORTED pill. Details and verdicts are in "Detector results" at the end; the one new system-level finding is **S1**.

### Design-specificity verdict

**Partly authored.** These parts belong to Folio:
- the token palette
- the right-aligned JetBrains Mono columns
- the bank ledger's GnuCash grammar (R column, Transfer/Splits, Debit/Credit, the amber unreviewed left rule)

The page shell around them is a generic admin template that DESIGN.md explicitly rejects:
- frosted translucent cards with `shadow-2xl`
- a teal pill before the card heading
- filler copy ("Explore your account structure.")
- large iOS-style toggle switches

The investment page is a stock-ticker page stacked on top of a ledger: the first transaction sits below the fold on a page badged "LEDGER".

### What's working

1. **Tabular money columns.** JetBrains Mono `tnum`, right-aligned under uppercase headers. The bank ledger scans well at 1440.
2. **Status shown where you work.** The SimpleFIN chip appears per account and in the ledger header; unreviewed counts roll up the tree; unreviewed rows get an amber left rule.
3. **Shortcuts are shown on screen.** "(press / to focus)", the Alt+R chip on Reconcile, Ctrl K. Power-user paths are discoverable.

---

## Findings: Accounts page (`/accounts`)

Severity: P0 blocks the task, P1 major, P2 minor, P3 polish.

### A1 · P0 · The filter input collapses to 77 px ("Filter a")
- **Where:** `src/components/ui/FilterBar.tsx:31` (desktop row), `src/components/AccountHierarchy.tsx:1174-1179` (input).
- **What's wrong:** the primary control has `flex-1` (basis 0) in a wrapping row, so the siblings take everything. It measures 77 px at both 1440 and 2560, and the placeholder is unreadable. The input is also hand-rolled (`rounded-lg` = 10 px, `px-4 py-2`) instead of the shared recipe, and its only label is the placeholder.
- **Fix:**
  - In `FilterBar`, give `primary` a real basis on desktop, e.g. wrap it in `md:flex-[1_1_20rem] md:min-w-[16rem] md:max-w-[32rem]`. This fixes every FilterBar consumer, not just Accounts.
  - Build the input from `inputClass()` in `ui/form.tsx`, with `type="search"` and an `aria-label="Filter accounts"`.
  - Shorten the placeholder to "Filter accounts" and show `/` as a `<kbd>` hint inside the field, the way the Ctrl K search pill does.
- **DESIGN.md:** Form controls, one input recipe (`INPUT`/`SELECT` in `ui/form.tsx`, radius md).

### A2 · P1 · The page is held to 1152 px (half a 2560 screen)
- **Where:** `src/components/Layout.tsx:546-554` (`isFullWidthPage` matches `/accounts/` but not `/accounts`), wrapper `max-w-6xl mx-auto`.
- **What's wrong:** at 2560 the content uses 1152 of 2304 px, with 576 px empty on each side. That is narrower than DESIGN.md's own 1400 px maximum. The account-name column is the elastic one, so the extra width is not even spent on data.
- **Fix (in-rule):** add `/accounts` to the full-width list and have the page own its width with `max-w-[1400px]`, the same way the Investments section does. The 980 px table minimum then has room for more numeric columns.
- **Fix (recommended, DEVIATION):** see L1 for the "data surface" width proposal, which would let Accounts go to about 1920 px with more period columns.
- **DESIGN.md:** Layout, max content width 1400 px; KPI section primitives, "Section pages own their width".

### A3 · P1 · Header and toolbar: three stacked headers and eight one-off controls
- **Where:** `accounts/page.tsx:25-35` (h1, subtitle, date picker); `AccountHierarchy.tsx:1151-1325` (card h2 with pill, New Account, FilterBar contents).
- **What's wrong:**
  - **Wasted height:** 254 px of chrome above the first row at 1440.
  - **Off-scale h1:** it is 30 px (`text-3xl`); the DESIGN scale is 12/13/14/16/20/24/32.
  - **Filler copy:** the subtitle says nothing.
  - **Redundant h2:** "Account Assets & Liabilities" repeats the page title, wrongly (the tree also lists Income, Expense and Equity), and carries a decorative `w-2 h-6 bg-primary rounded-full` pill.
  - **Inconsistent toolbar controls:**
    - two 56×44 px iOS toggles, one of them amber
    - an EXPAND label followed by two buttons plus a 7-option select
    - a SORT BY label followed by a select with no direction control
    - a Columns button
    - heights mixed at 38 px and 44 px
    - three different text sizes (12, 13 and 14 px)
- **Fix:** one header row, then one toolbar row.

  **Header row:**
  - "Accounts" h1 at 24 px on the left.
  - Date range and the primary **New Account** button on the right.
  - Delete the subtitle and the card h2.

  **Toolbar row**, built from the Investments primitives:
  - **Filter** at a flexible width (A1).
  - A **`Segmented`** depth control: `Collapse · 1 · 2 · 3 · All`. This replaces Collapse All, Expand All and the 7-option select, and fixes the ">4 options" load.
  - A **"View" menu button** holding three checkbox items: *Needs review only*, *Show hidden accounts* and *Columns…*. This brings it in line with the ledger, which already has a View menu.
  - **Sorting** moves to the column headers: click to sort, with a direction caret and `aria-sort`. The Sort By select goes.

  All controls 36 px high on desktop, with 44 px touch targets kept for mobile only.
- **DESIGN.md:** Typography scale; Decoration "minimal, no decorative elements"; KPI cards and section primitives ("One control vocabulary per section", `Segmented`).

### A4 · P2 · Green `$0.00` everywhere drowns the real signal
- **Where:** `AccountHierarchy.tsx:882`, `:893` (`< 0 ? 'text-negative' : 'text-positive'`).
- **What's wrong:** zero balances render in `--positive`. At 1440, 7 of the 15 visible rows show a green `$0.00` in Total or Period. That contradicts DESIGN.md's "Neutral amounts: `--foreground-secondary`" and makes a zero look like a gain.
- **Fix:**
  - Use a three-way class: negative → `--negative`, zero → `--foreground-muted`, positive → `--positive` (or `--foreground`; see the open question at the end).
  - Optionally render exact zero as an en dash, as the investment ledger already does for empty Buy/Sell cells.
- **DESIGN.md:** Financial Data Display, neutral amounts.

### A5 · P2 · Redundant "Balance in commodity" column
- **Where:** the column definitions in `AccountHierarchy.tsx`.
- **What's wrong:** for USD accounts it repeats the Total figure in a different format ("17,113.37 USD" next to "$17,113.37"). For parents it shows the parent's *own* balance (e.g. Assets "-150.00 USD"), which reads like an error.
- **Fix:** hide the column by default. Show it only on rows whose commodity differs from the report currency (shares, foreign cash), and show the rollup-vs-own distinction in a `Tip`.
- **DESIGN.md:** Aesthetic, data-dense but function-first.

### A6 · P1 · Phone: balances are clipped off-screen
- **Where:** `AccountHierarchy.tsx:1328-1329` (`overflow-x-auto` around `table w-full`); at 412 the table is 420 px inside a 354 px container.
- **What's wrong:** the only thing a phone user comes to the tree for, the balance, is cut to "$1" behind a sideways scroll. The card also spends 32 px of padding plus a heading row on chrome.
- **Fix:** below `md`, render each row as `name ……… total` with one numeric column (Total; Period appears in an expanded row or under a View toggle). Drop the card's `p-3` gutter so rows run full width.
- **DESIGN.md:** Layout, 12-column grid collapsing to 4 on mobile.

### A7 · P2 · Toolbar and tree accessibility
- **Where:** `AccountHierarchy.tsx:1196-1210`, `:1273`, `:819-829`, `:797`, `:864`.
- **What's wrong:**
  - The two switches are `<button>`s with no accessible name, role or state; their visible labels are unrelated `<span>`s.
  - The Columns button has no `aria-expanded`.
  - Row actions are `opacity-0 group-hover:opacity-100` with no `focus-within` reveal, so keyboard users tab onto invisible buttons.
  - The per-row "View Ledger" `<Link>` carries a native **`title="View Ledger"`** and duplicates the name link's tab stop.
  - `TagChip` also receives a native `title` (`:797`).
  - Delete uses `hover:text-negative`, which is the money colour, not a system state.
- **Fix:**
  - The switches go away in A3. If kept, use `role="switch" aria-checked` with a `<label>`.
  - Add `aria-expanded` and `aria-haspopup` to the menu button.
  - Add `group-focus-within:opacity-100`.
  - Remove the duplicate View Ledger link (the name already links), or wrap it in `<Tip>` with an `aria-label`.
  - Swap `title` for `Tip` on `TagChip`.
  - Use `hover:text-error` / `hover:bg-error/20` for Delete.
- **DESIGN.md:** Tooltips and hints (native `title=` banned); Money vs system state.

### A8 · P2 · The whole tree renders at once
- **Where:** `AccountHierarchy.tsx:1376` (all `getRowModel().rows`).
- **What's wrong:** with the stored expansion, the page renders 2,325 interactive elements in a 14,602 px table, each row with hover-only action buttons. Filtering and typing re-render all of it. The large `backdrop-blur-xl` panel behind a long scroll adds compositing cost.
- **Fix:** virtualize rows (`@tanstack/react-virtual`; TanStack Table is already in use), or at least mount row actions only on the hovered or focused row. Removing the blur (A9) also helps.
- **DESIGN.md:** n/a (performance).

### A9 · P2 · Frosted glass, heavy shadow, and a `rounded-full` pill
- **Where:** `accounts/page.tsx:38,45,63`; `AccountHierarchy.tsx:1150,1154`.
- **What's wrong:** `bg-surface/30 backdrop-blur-xl … shadow-2xl` is glassmorphism. DESIGN.md says "Minimal (borders and subtle elevation only)". The pill uses `rounded-full`, which is reserved for avatars.
- **Fix:** `bg-surface border border-border rounded-lg` and no shadow, or `shadow-sm` at most. Delete the pill. This applies to the loading and error states too.
- **DESIGN.md:** Aesthetic Direction, Decoration level; Border radius ("full: avatars only").

---

## Findings: Ledger pages (`/accounts/[guid]`)

### L1 · P1 · Unbounded width: amounts drift 1,500 px from their description at 2560
- **Where:** `Layout.tsx:546-554` puts `/accounts/*` on the full-width list with no cap; `AccountLedger.tsx:2289` table container.
- **What's wrong:**
  - The table is 2238 px wide at 2560.
  - Description is the elastic column, so about 850 px of empty space opens between the description and Transfer, and the eye jumps 1,500 px to find the amount.
  - The 1630 px search box is wider than most reports.
  - At 1440 the same table is comfortable, which shows the problem is the missing cap, not the columns.
- **Fix (in-rule):** cap the ledger at `max-w-[1400px] mx-auto`, consistent with A2.
- **Fix (recommended, DEVIATION, needs owner approval):** add a **"data surface" width tier, `max-w-[1920px]`**, to DESIGN.md for the account tree, the ledgers and the general ledger. Inside it:
  - cap Description at about `60ch`
  - let Transfer take a fixed share
  - keep the numeric columns tight and right-aligned against the description block

  The owner works at 2560 and asked for more width; 1400 px is a dashboard measure, not a register measure. Record the change in the Decisions Log.
- **DESIGN.md:** Layout, max content width 1400 px (the in-rule fix) or a DESIGN.md change (the recommended fix).

### L2 · P1 · Investment header balance contradicts the page
- **Where:** `accounts/[guid]/page.tsx:121-122` (`currentBalance = transactions[0]?.running_balance`), `:173-178` (`'$0.00'` fallback, `text-positive` for anything ≥ 0).
- **What's wrong:**
  - "Current Balance" is really "the running balance of the newest row loaded in the date range". With the default "This Year" range and no trades this year, VTI shows **$0.00** while the KPI row directly below shows 705.9206 shares worth $262,298.92.
  - When rows do load, a share count is formatted as currency in `--positive` green.
  - The same bug hits any bank account with no activity in range.
- **Fix:**
  - Fetch the balance **as of the range end**, independent of which rows loaded, and label it "Balance · Oct 31, 2026" (or "Today" when the range ends today).
  - For non-currency commodities, show `705.9206 sh` in `--foreground` and put market value next to it.
  - Never fall back to a hard-coded `$0.00`.
- **DESIGN.md:** Product principle "explainable numbers"; Financial Data Display (sign colours are for amounts).

### L3 · P1 · Investment page: the ledger starts below the fold and its table overflows
- **Where:**
  - `InvestmentAccount.tsx:365-430` (security card)
  - `:433-470` (KPI row)
  - `:488-…` (price chart, its own 1M–ALL period state at `:80`, `:493`)
  - the investment table columns in `AccountLedger.tsx`
- **What's wrong:**
  - **Below the fold:** at 1440×900 the table begins at y = 965; no transaction is visible on a page titled "VTI · LEDGER".
  - **Repeated name:** VTI appears four times (eyebrow, h1, path, card title).
  - **Duplicated action:** "New Transaction" appears in both the security card and the ledger toolbar, in two different button styles.
  - **Table overflow:** at 1440 the table is 1286 px in a 1118 px viewport, so Share Bal and Cost Basis scroll off to the right.
  - **Tall rows:** the lot chip "Buy 2025-12-24" wraps to three lines and Description wraps to five, giving rows about 71 px tall.
  - **Suspect column:** Cost Basis reads `$0.00` on every row. Check whether this is a bug or a meaningless column.
  - **Conflicting ranges:** the chart's own period ("3M") silently disagrees with the page range.
- **Fix:**
  - **Merge the security card into the page header.** Show symbol, name, last price with its date, and the Fetch Price / Add Price actions as icon buttons with `Tip`. Show "New Transaction" once, in the ledger toolbar.
  - **Turn the KPI row into `KpiCard`s that link somewhere**, per the 2026-10-13 rule:
    - Shares → Lots view
    - Cost basis → lot detail
    - Market value → price history
    - Gain → realized/unrealized report
  - **Collapse the price chart** into a `ChartPanel` that is closed by default (remember the state per user), whose period follows the page date range.
  - **Make lot chips single-line:** `L1 · 12/24/25`, mono, `whitespace-nowrap`. Set `min-width` on Description and let Transfer truncate with a `Tip`, so the table fits 1118 px.
- **DESIGN.md:** KPI cards and section primitives (KpiCard, ChartPanel, Segmented, CHART_THEME); "Every KPI card is a way in".

### L4 · P2 · Header: two breadcrumbs, a meaningless badge, an off-scale h1
- **Where:** `accounts/[guid]/page.tsx:129-189`.
- **What's wrong:**
  - **Two breadcrumbs:** the uppercase eyebrow "ACCOUNTS / ALLY INTEREST CHECKING" repeats the h1, then a colon path ("Assets : Current Assets : Checking Account : Ally Interest Checking") repeats the name a third time. Its `:` separators are `--border-hover` and nearly invisible.
  - **Badge:** "LEDGER" carries no information.
  - **Off-scale h1:** 30 px.
  - **Scattered controls:** the date picker and Current Balance sit in a separate right column whose baseline does not line up with the h1.
  - **Phone height:** at 412 the header is 260 px tall before the first transaction.
- **Fix:**
  - **Row 1:** one breadcrumb built from the full path, with every ancestor a link and "Accounts" as the root, at 12 px `--foreground-muted` with `/` separators.
  - **Row 2:** the h1 (24 px) + SimpleFIN chip on the left; the balance block (label + mono 24 px) right-aligned on the same baseline.
  - **Move the date range into the ledger toolbar.** It filters the table, so it belongs with Filters and Search.
  - Delete the LEDGER badge.
  - On phones: breadcrumb collapsed to "‹ Checking Account", then h1, then the balance. That is about 120 px.
- **DESIGN.md:** Typography scale; Decoration minimal.

### L5 · P2 · Row noise and density
- **Where:** `AccountLedger.tsx` row renderer (imported chip, `text-[9px]`/`[10px]`/`[11px]`, 14 uses).
- **What's wrong:**
  - **Chip on every row:** every SimpleFIN row carries a 9 px amber "IMPORTED" chip, so the chip marks nothing. The amber unreviewed left rule already flags review state.
  - **Below the type scale:** dates and chips are set at 9–11 px, under the scale's 12 px floor.
  - **Low density:** row pitch is about 53 px, giving 10 rows per 900 px screen, which is low for a register.
  - **Green balances:** every Balance cell is green because the balance is positive. That is a sign colour on a state.
- **Fix:**
  - Drop the per-row chip. Make "Imported / Manual" a Filters option, and if it is still wanted, show it as a 12 px muted glyph in the R column.
  - Raise the minimum text size to 12 px.
  - Use a 36–40 px row pitch on desktop.
  - Render running balances in `--foreground` (sign colour only when negative), and keep green/red for the Debit/Credit flows.
- **DESIGN.md:** Typography scale 12+; Color "rare and meaningful".

### L6 · P2 · Bank ledger on a phone: 2.5 transactions per screen
- **Where:** the mobile card renderer in `AccountLedger.tsx`.
- **What's wrong:**
  - **Wasteful layout:** the bank cards are label/value stacks (DATE, RECEIPTS, DESCRIPTION, TRANSFER, CREDIT, BALANCE, RECONCILE), about 270 px each, with a right-aligned multi-line description and a "RECEIPTS" row that holds only an icon.
  - **Inconsistent with investments:** the investment ledger's mobile card is already a good compact pattern (date, description + amount on one line, transfer, then a meta line).
- **Fix:** reuse the investment card shape for bank rows:
  - Line 1: description and amount.
  - Line 2: date · transfer, with the balance on the right.
  - The R state and the receipt as small glyphs.

  That gives 6–7 per screen.
- **DESIGN.md:** Density "comfortable"; Consistency.

### L7 · P2 · Chart and panels outside the token system
- **Where:** `InvestmentAccount.tsx:572-666` (raw `#737373`, `#404040`, `#171717`, `#a3a3a3`, `#06b6d4`; gradient fills `investFillGradient` / `investStrokeGradient`); `:339-488` (8× `backdrop-blur-xl`); `AccountLedger.tsx:2289` (`backdrop-blur-xl … shadow-2xl`); period buttons hand-rolled as solid primary.
- **What's wrong:**
  - **Theming:** the hex colours ignore the theme, so in light mode the chart has dark tooltips and neutral greys that do not belong to Folio's slate palette.
  - **Off-palette line:** cyan `#06b6d4` is not the teal accent.
  - **Gradient fills** go against the "No gradients. Ever." rule. The zero-crossing stroke split is functional, but the opacity fade fill is decorative.
  - **Period buttons** are a fourth button style.
- **Fix:**
  - Use `CHART_THEME` from `investments/ui.tsx` for the axes, grid, tooltip and line.
  - Use a flat 10–15% fill (no fade), or no fill.
  - Use `Segmented` for the periods and the $/% toggle.
  - Use plain `bg-surface border` panels.
- **DESIGN.md:** Gradient policy; KPI section primitives (`CHART_THEME` "recharts on tokens, never raw hex"; `Segmented`).

### L8 · P2 · Silent failures and an empty state that looks like the end
- **Where:** `AccountLedger.tsx:2256` (`catch {}` on the cost-basis PATCH); `:2686`, `:3469` ("End of Records").
- **What's wrong:**
  - **Silent failure:** changing FIFO/LIFO writes an account preference and any failure is discarded.
  - **Empty state:** with no rows in range, the table shows only "END OF RECORDS". On VTI's default view that tells the owner nothing about the 705 shares they hold or how to see them.
  - **Toolbar contrast:** buttons are 12 px `--foreground-muted` on `--surface`, measured at 3.7–3.9:1, which fails AA for small text (see S1).
- **Fix:**
  - Toast on failure and revert the select.
  - Empty state: "No transactions in *This Year*." plus a "Show all dates" button.
  - Toolbar buttons at 13 px in `--foreground-secondary`.
- **DESIGN.md:** Money vs system state (`--error` for request failures); Motion/feedback.

### L9 · P3 · Header Reconcile link uses native `title`, and the guard test cannot see it
- **Where:** `accounts/[guid]/page.tsx:171`, `AccountHierarchy.tsx:797`, `:822`; guard `src/__tests__/no-native-title.test.ts:57,102` only flags lowercase (intrinsic) tags.
- **What's wrong:** `title` passed to `<Link>` or `TagChip` reaches the DOM as a native tooltip, which DESIGN.md bans app-wide. The guard test skips capitalized components, so these three slip through.
- **Fix:**
  - Replace the three uses with `Tip`.
  - Extend the test to flag a `title` prop on `Link` and on any component known to spread props onto a DOM node, or ban the `title` prop name outside an explicit allowlist (`Modal`, `Panel`).
  - The Reconcile header link is being reworked in the parallel reconcile session; fold the `title` removal into that change.
- **DESIGN.md:** Tooltips and hints.

---

## Persona red flags

- **Alex (keyboard power user):**
  - The 77 px filter box is useless.
  - Sorting is a select with no direction and no header click.
  - Depth needs a mouse on a 7-option select.
  - On investment pages "New Transaction" appears twice and FIFO changes persist without confirmation.
- **Sam (screen reader / keyboard only):**
  - Unnamed switches.
  - Inputs labelled only by placeholder.
  - Hover-only row actions that keyboard focus lands on invisibly.
  - A native `title`.
  - Chart period buttons without `aria-pressed`.
  - Toolbar and label text at 3.7–3.9:1.
- **The owner (2560 desk monitor, sometimes a phone):**
  - At 2560 the tree uses half the screen while the ledger flings amounts 1,500 px from their description.
  - On a phone the tree hides every balance and the ledger header eats 260 px.
  - Getting from a tree row to reconciling takes two page loads.

## Questions for the owner

1. Should a running balance (a state) ever be green? Recommendation: `--foreground` for balances and totals, sign colour only for flows, gains and negatives.
2. Should Accounts and the ledger become a split view at ≥1920 px (tree on the left, ledger on the right), instead of two pages fighting over width?
3. On an investment account, is the page a ledger or a security page? Recommendation: ledger first, security summary compact in the header, chart collapsible.

---

## Proposed implementation plan

Ordered so that each step ships on its own and the owner's three complaints are fixed first. Steps 1–3 only touch Accounts, the ledger header, `FilterBar` and `Layout`. Coordinate with the reconcile session before step 3, since it edits the ledger header's Reconcile control.

| Step | Fixes | Files | Size |
|---|---|---|---|
| 1. **Width** | A2, L1 | `Layout.tsx` (width tiers); `DESIGN.md` Decisions Log if the 1920 px data-surface tier is approved | S |
| 2. **Accounts header + toolbar** | A1, A3, A7, A9 (Accounts part) | `FilterBar.tsx` (primary basis), `accounts/page.tsx`, `AccountHierarchy.tsx` toolbar; reuse `Segmented`, `inputClass()`, `Tip` | M |
| 3. **Ledger header** | L2, L4, L9 | `accounts/[guid]/page.tsx` (one breadcrumb, h1 24 px, balance as of range end, date range moved into the toolbar) plus a balance-as-of API if none exists | M |
| 4. **Investment page** | L3, L7, L8 (empty state) | `InvestmentAccount.tsx` → header summary + linked `KpiCard`s + collapsible `ChartPanel` on `CHART_THEME`; lot chip and column widths in `AccountLedger.tsx` | M–L |
| 5. **Money colour, row density, label contrast** | A4, A5, L5, S1 | amount colour helper shared by tree and ledger; ledger row pitch and type floor | S–M |
| 6. **Phone** | A6, L6 | tree mobile row; bank mobile card reuses the investment card shape | M |
| 7. **Hardening** | A8, L8 (silent PATCH), L9 (guard test) | tree virtualization, error toast, `no-native-title.test.ts` extension | M |
| 8. **Verify** | all | re-run `/impeccable critique` + `audit` at 1440 / 2560 / 412; target ≥ 30/40 and ≥ 16/20 | S |

---

## Detector results (Assessment B)

### CLI scan

`impeccable detect --json` was run over the six target files and `src/components/ledger/` (19 files).

| Rule | Count | Location | Verdict |
|---|---|---|---|
| `side-tab` (slop) | 1 | `AccountLedger.tsx:2550`, `border-l-2 border-l-warning` on the mobile investment card | **False positive.** The left rule is conditional and means "unreviewed" on a swipe-to-review card. It carries state, not decoration. |

The other five files and `src/components/ledger/` are clean. The CLI cannot see the problems this review is mostly about (layout, width, duplicated headers), so the browser overlay below carries most of the evidence.

### Browser overlay

`detect.js` was injected into the live pages: headless Chromium, 1440×900, dark theme. The live server was stopped afterwards.

| Page | Findings | Breakdown |
|---|---|---|
| `/accounts` (441 rows) | 27 | `undersized-ui-text` ×23 (10 px unreviewed-count badges); `low-contrast` ×4 (subtitle, "EXPAND" label, sidebar link at 3.7–3.9:1; filter placeholder 4.46:1) |
| Bank ledger (100 rows) | 135 | `undersized-ui-text` ×106 (100 × 9 px "IMPORTED" pill, 6 × 10 px column headers); `tight-leading` ×21 (description cells at 1.25); `low-contrast` ×8 (breadcrumb, LEDGER chip, CURRENT BALANCE label, "New Transaction" button, 10 px "Alt+R" kbd, 20×20 px "N" reconcile button, placeholder) |
| Investment ledger (18 rows) | 39 | `undersized-ui-text` ×26 (10 px headers, 10 px L1–L15 lot badges); `low-contrast` ×12 (the same shell items plus KPI labels SHARES / COST BASIS / MARKET VALUE / GAIN/LOSS and the security subtitle); `tight-leading` ×1 |

### Where the detector and the design review agree, and where they don't

- **Agree: `--foreground-muted` (`#64748b`) is too dim for 10–12 px text.** It measures 3.7–3.9:1 on `--surface` and `--background`. This is not a one-off: the same token drives the breadcrumb, KPI labels, toolbar buttons and the sidebar. It refines A7/L8 into a **system-level finding**, given as **S1** below.
- **Agree: 9–11 px type.** The IMPORTED pill (9 px), headers, badges and lot chips (10 px) sit under DESIGN.md's 12 px floor. This supports L5.
- **Partly false positive: `tight-leading` on single-line truncated table cells.** Leading of 1.25 is normal for dense rows. It does matter on rows that wrap to 2–5 lines (VTI Description, long bank memos), but there the fix is L3/L5 (stop the wrapping), not more leading.
- **Detector blind spot:** the 77 px filter, the 1152 px / unbounded widths, the $0.00 investment balance, the overflow at 1440 and the duplicated headers. None of these are pattern-detectable. They came from the design review and the measurements.

### S1 · P1 · The muted-text token fails WCAG AA at the sizes it is used for (system-level, DEVIATION)
- **Where:** `--foreground-muted` in `src/app/globals.css`, used for labels, breadcrumbs, KPI labels and toolbar buttons across both pages.
- **What's wrong:** `#64748b` on `#131d2e` is 3.7–3.9:1, below 4.5:1 for text under 18 px. DESIGN.md assigns it to "Muted text, placeholders", but the app uses it for real labels at 10–12 px.
- **Fix, either:**
  - **(a) Token change (DEVIATION, needs owner approval):** raise dark `--foreground-muted` to about `#7c8aa0`. That gives about 4.8:1 on `--surface` and keeps the three-step hierarchy against `--foreground-secondary` `#94a3b8`. Record it in the Decisions Log.
  - **(b) No token change:** move every *label* (KPI labels, toolbar buttons, breadcrumb, table headers) to `--foreground-secondary`, and keep `--foreground-muted` for placeholders and disabled text only.

  Recommendation: (b) now, as part of steps 2–4, and (a) only if (b) flattens the hierarchy too much.
- **DESIGN.md:** Color table (token roles); accessibility.

---

## Implementation (2026-11-02)

Owner decisions: the 1920px data-surface tier and the brighter `--foreground-muted` are approved; balances keep sign colour (positive green, negative red) with zero muted; investment pages are ledger first; the split view is optional. The owner also called the Accounts toggles "outrageously large and ugly"; they are gone (folded into a View menu).

### Before → after (headless Chromium, dark theme, same accounts)

| Measure | Before | After |
|---|---|---|
| Accounts filter input @1440 / @2560 | 77 px / 77 px | 448 px / 448 px |
| Accounts content width @2560 | 1152 px | 1920 px (numbers packed beside names from 1800px) |
| Accounts first account row @1440 | y ≈ 391 (254 px of chrome above the table) | y = 250 |
| Accounts interactive elements (full tree) | 2,325 | 1,004 |
| Accounts @412 balance column | clipped to "$1" | fits (412 / 412, no scroll) |
| Bank ledger table @2560 | 2238 px, unbounded | 1918 px inside the 1920 cap; description sizes to its text |
| Bank ledger table @1440 | 1118 px | 1118 px, no horizontal scroll |
| Bank ledger row pitch | ~53 px | 41 px |
| Bank ledger mobile card | ~270 px | ~65 px |
| VTI header balance ("This Year") | **$0.00** | 705.9206 VTI ≈ $262,298.92, "as of Today" |
| VTI table @1440 (all dates) | 1286 px in 1118 (Share Bal cut off) | 1118 px, no scroll |
| VTI first transaction @1440×900 | y = 965 (below the fold) | y = 534 |
| Native `title=` in `<main>` | 3 (+ guard blind spot) | 0; guard now covers `<Link>` |

### Status per finding

| # | Status | What changed |
|---|---|---|
| A1 | Done | Filter is a real flex basis (`sm:flex-[1_1_18rem]`, 14–28rem), `inputClass()` recipe, `type="search"`, `aria-label`, `/` kbd hint. `FilterBar` itself is unchanged (its other consumers were not in scope). |
| A2, L1 | Done | `/accounts` joins the full-bleed list in `Layout.tsx`; pages own `DATA_SURFACE_MAX_WIDTH` (`src/components/ui/layout-widths.ts`). DESIGN.md "Layout" and Decisions Log updated. From 1800px a trailing column absorbs spare width in the tree and the ledger so amounts sit beside their text. |
| A3 | Done | One header row (24px h1, date range, New Account), one toolbar row: filter · `Segmented` depth (Collapse·1·2·3·All) · "To review only" chip when active · View menu (To review only, Show hidden accounts, Columns with drag-to-reorder). Sorting moved to column headers with `aria-sort` and a direction caret. Subtitle, card h2 and pill deleted. |
| A4 | Done | `amountToneClass()` in `src/lib/format.ts`: positive green, negative red, zero muted. |
| A5 | Done | Column renamed "Units", hidden by default for new users, and filled only for non-USD rows (shares, foreign cash) with a `Tip` explaining own-vs-rollup. |
| A6 | Done | Fixed table layout on phones (name + balance), full-bleed card, tags hidden below `md`. |
| A7 | Done | Toggles replaced by menu checkboxes with `role="checkbox"`; expanders have `aria-expanded` and a named label; the duplicate "View Ledger" link and the three hover buttons are replaced by one "⋯" actions button that is visible on hover *and* keyboard focus and opens the existing context menu (Delete keeps the menu's danger styling). TagChip's `title` already routed through `Tip` (false positive). |
| A8 | Partly | Interactive elements cut from 2,325 to 1,004 and the blur removed. Row virtualization is **not** done (no virtualizer dependency in the project). |
| A9 | Done | Glass, `shadow-2xl` and the `rounded-full` pill removed from Accounts, the ledger page and the investment panels. |
| L2 | Done | Header balance comes from `/api/accounts/[guid]/balance?asOfDate=` at the range end (or today), labelled "Balance · Today" / "· Oct 31, 2026"; never a hard-coded `$0.00`. The route now counts the as-of day itself (`post_date < date + 1`; GnuCash posts at 10:59 UTC). Investments show shares in `--foreground` plus market value. |
| L3 | Done | Ledger first: compact security line in the header (full name, last price, Fetch/Add price icon buttons), four linked `KpiCard`s (Shares → lots, Cost basis → lots, Market value → price history, Gain → lots report), then the register, then the price chart as a collapsible panel (closed by default, remembered, opens from `#price-history`) whose range follows the page date range. "New Transaction" now appears once (ledger toolbar). Lot chips are single-line; the lot date shows from 1800px. A Cost Basis column that is a dash on every loaded row is dropped. |
| L4 | Done | One breadcrumb (ancestors as links, `/` separators; "‹ Parent" on phones), 24px h1, no LEDGER badge, date range moved into the ledger toolbar. Phone header 260 → 122px (bank). |
| L5 | Done | IMPORTED chip removed; Bank-verified is a 12px muted mark; no text under 12px except the Alt+R kbd; headers 12px `--foreground-secondary`; row pitch 41px. Balances keep sign colour per the owner. |
| L6 | Done | Bank mobile cards reuse the compact two-line shape (~65px each). |
| L7 | Done | Chart on `CHART_THEME` and `var(--primary)`; flat 10% fill in % mode, no gradients; `Segmented` for $/%; plain `bg-surface` panels. |
| L8 | Done | Cost-method save failure toasts and reverts; empty state "No transactions in This Year." + "Show all dates" (and a "Clear search and filters" variant when a search narrows to nothing); toolbar labels at `--foreground-secondary`. |
| L9 | Done | `no-native-title.test.ts` now also checks `<Link>`; it found six more sites (tags page ×2, tax estimator ×2, MovementsTable, ContextualHelpLink), all moved to `Tip`. |
| S1 | Done (option a) | `--foreground-muted` dark `#64748b` → `#8090a6` (3.6 → 5.2:1 on `--surface`), light `#94a3b8` → `#64748b` (2.6 → 4.8:1). DESIGN.md colour tables and Decisions Log updated. |
| Split view | Done (optional) | "Split view" toggle on Accounts from 1920px viewports, remembered per browser. Tree (name + balance) left, ledger right; the open account is `?account=` in the URL; breadcrumbs open ancestors in the pane; Esc or × closes it; ↗ opens the full page. |

### Not done / found along the way

- **Fixed afterwards: investment running totals.** Two pre-existing bugs in `src/app/api/accounts/[guid]/transactions/route.ts`:
  1. The replay was filtered to `startDate`, so Share Bal and Cost Basis restarted at zero (VTI from 2025: −105.66 shares). Both paths now replay from the start of history and report only in-range rows.
  2. Sibling accounts were loaded without `account_type`, so in a book with trading accounts every buy's `Trading:…:VTI` leg made it read as a $0 transfer-in: VTI's Cost Basis was $0 "fully covered" over its whole history. It now reads $86,798.23 on the newest row, matching the KPI.

  The running-totals cache key moved to `investment-ledger-v5`. Regression tests are in `route.cost-basis-coverage.test.ts`; each fails without its fix.
- Row virtualization for the account tree (A8).
- `KpiCard` labels are 11px (shared Investments primitive, used app-wide); left as is.
- At 1440 the investment register's Description column is narrow (~110px of text) because nine numeric/lot columns need the room; full text is in a `Tip`, and collapsing the sidebar gives it back.
