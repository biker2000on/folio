---
target: dashboard overview and action center
total_score: 16
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 4
target_identity: "file:C:\\Users\\biker\\projects\\gnucash-web\\src\\app\\(main)\\actions\\page.tsx"
target_fingerprint: "sha256:3737698730f7178b1732a6021a93029ed30a64522ccc4e7f2e0d18b6ce4521eb"
target_path: "C:\\Users\\biker\\projects\\gnucash-web\\src\\app\\(main)\\actions\\page.tsx"
timestamp: 2026-11-16T13-35-41Z
slug: src-app-main-actions-page-tsx
---
Method: dual-agent (A: design review · B: detector + browser evidence)

Surfaces: Financial Action Center (/actions) 16/40 before fixes; Dashboard (/dashboard) 24/40.

## Action Center heuristics (before)
1 Status 2 · 2 Real world 1 · 3 Control 2 · 4 Consistency 2 · 5 Error prevention 1 · 6 Recognition 2 · 7 Efficiency 2 · 8 Minimalist 1 · 9 Recovery 2 · 10 Help 1 = 16/40

## Dashboard heuristics
1 Status 2 · 2 Real world 3 · 3 Control 3 · 4 Consistency 2 · 5 Error prevention 3 · 6 Recognition 2 · 7 Efficiency 3 · 8 Minimalist 2 · 9 Recovery 2 · 10 Help 2 = 24/40

## Priority issues
- [P0] Action Center: one card per underlying row (286 cards, 45,976px). FIXED: rule groups + drill-down.
- [P0] Action Center: no way to turn a rule off. FIXED: Rules panel, per book.
- [P1] Spending spikes filed as "Failed job / critical"; every stale reconciliation critical. FIXED.
- [P1] New-merchant detector keyed on full description, fired for hand-entered charges, two overlapping detectors. FIXED: merchant-identity.
- [P1] Dashboard KPI cards are template cards: icon chip, sans money (KPIGrid.tsx:168), not a stretched link, 11px Explain, no period or comparison. OPEN.
- [P1] Dashboard held to 1152px (Layout.tsx max-w-6xl), not the documented 1400px. OPEN.
- [P2] Dashboard charts use three off-token palettes; three donuts restate the Sankey. OPEN.
- [P2] Dashboard has no bridge to the Action Center. OPEN.
- [P2] Action card anatomy: 10px severity chips, five controls per card, Accept on every Decide item. OPEN.
- [P3] Savings-rate insight divides by near-zero income (-2056%). OPEN.

## Detector
CLI: 1 warning, border-accent-on-rounded at actions/page.tsx:772 (lane rule; rounded-lg removed). Browser: /actions 461 findings, nearly all the 10px badge repeated per card; /dashboard skipped heading (h1 then h3) and 11px text. Light theme contrast failures: warning badge 2.72:1, positive text 3.30:1, chart ticks #f87171 on white 2.77:1.
