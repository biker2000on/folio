---
target: Administration section incl. Connections
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\biker\\projects\\gnucash-web\\src\\app\\(main)\\settings"
timestamp: 2026-11-05T17-36-05Z
slug: src-app-main-settings
---
Method: dual-agent (A: design review sub-agent · B: detector + browser sub-agent)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Connections renders only a spinner for 10+s at desktop: the whole page waits on /api/simplefin/status. No last-sync time per account. |
| 2 | Match System / Real World | 2 | Errors start with "all:"; "Stored mapping"; raw role values; PASSWORD badge on users |
| 3 | User Control and Freedom | 2 | Mapping saves the moment it's picked, with no undo; role changes have no confirm; carry-over is all-or-nothing |
| 4 | Consistency and Standards | 1 | Pages use 5 different widths; only 4 of 10 use PageHeader; 6 nav labels don't match their page titles; 3 input recipes |
| 5 | Error Prevention | 2 | Pressing Tab in AccountSelector commits the highlighted option, which is a live save on Connections |
| 6 | Recognition Rather Than Recall | 2 | No filter for unmapped accounts; /settings/limits and /settings/api-docs aren't in the nav; Connections isn't on the hub |
| 7 | Flexibility and Efficiency | 2 | 36 rows with no bulk mapping, sort, filter or ignore; about 50 rule suggestions must be accepted one at a time |
| 8 | Aesthetic and Minimalist Design | 2 | 16 lines of duplicated error text; a Status column that repeats the picker; a Stripe card on a household book |
| 9 | Error Recovery | 1 | The red banner offers no action, repeats 4 messages ×4, and shows the bridge's "upgrading" notice as an error |
| 10 | Help and Documentation | 3 | SimpleFin onboarding steps, Atlas setup, API docs and the relink explanation are good |
| **Total** | | **19/40** | **Poor** |

## Design Specificity Verdict
LLM: competent but interchangeable admin scaffolding (cards, accordions, select-in-table). Product character lives in the copy: the provenance line, investment routing, the full account path, the relink explanation. The DESIGN.md "Bloomberg" direction is missing: balances are raw 12px DM Sans strings (`279516.71`) instead of JetBrains Mono, and dates use toLocaleString().
Deterministic: source scan clean on 13 files (regex only, so it is weak evidence). The browser scan found 134 findings on Connections (118 undersized-ui-text and 92 tiny-text from text-[10px] at page.tsx:633/645/662/687; 13 low-contrast; 2 nested-cards; 1 line-length), 10 on Rules, and 4–5 on the other pages, all from the shared sidebar. Most low-contrast hits come from one token: light --primary #0d9488 measures 3.74:1 on white. /settings/integrations returns 404. Dark mode is mostly clean.

## Priority Issues
1. [P1] Connections error wall misleads and buries the relink banner: errors duplicated (4×4), the bridge's "upgrading" notice shown in --error, no action, relink rows show only the old side. Fix: dedupe and group by institution, show upstream notices as --warning with raw text collapsed, put relink first, list old→new→book pairs with a checkbox per pair. (/impeccable clarify, /impeccable layout)
2. [P1] The mapping table doesn't support the job: 36 flat rows, no unmapped/stale filter, no "ignore" state, redundant Status column, empty Last 4, unformatted balances, 10px text, mobile omits provenance. Fix: group by institution with counts, segmented filter, Ignore state, mono right-aligned balance column. (/impeccable layout, /impeccable distill)
3. [P2] Composition and loading: one status fetch blocks the page including Stripe; Invoice Payments leads on a household book. Fix: load each section on its own, put Bank Connections first, gate Stripe to business books with invoicing. (/impeccable harden)
4. [P2] The section is incoherent: nav labels vs page titles, widths, headers, Commodities text-3xl, link-only accordions, 404 integrations index, Atlas not gated to farm books. (/impeccable polish)
5. [P2] Accessibility: AccountSelector has no name/role (36 identical fields); Tab commits a live save; PaymentConnectionCard labels aren't tied to inputs; no live region for sync; light --primary fails AA app-wide; brand "Folio" is a second h1. (/impeccable audit)

## Persona Red Flags
Alex: can't bulk-map, filter or ignore; a toast for every row; must search 22 hub rows plus 8 nav pages with mismatched names; no per-account last sync.
Sam: 36 unnamed comboboxes; Tab commits a mapping; weak focus ring; status changes not announced; 10px uppercase text and 12px checkboxes.

## Minor Observations
History DELETE badge and Rules delete hover use --negative instead of --error; three undo verbs; hand-rolled inputs; dead KPI cards on Commodities/Atlas; API docs overflows at 390px; nav active state wrong on /admin/feedback, /settings/limits and /settings/api-docs; "..." and "…" mixed; SimpleFin price hard-coded; success shown in --primary.

## Questions to Consider
- If 13 of 36 accounts are intentionally unmapped, is "Unmapped" a warning or a decision?
- Should import health live where imports land (Money), leaving Administration for set-and-forget settings?
- Should /settings be a searchable index rather than a 22-row accordion?
