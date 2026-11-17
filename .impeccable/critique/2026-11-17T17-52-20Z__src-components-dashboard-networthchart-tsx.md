---
target: dashboard net worth and cash flow charts
total_score: 16
max_score: 36
na_heuristics: 9
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\biker\\projects\\gnucash-web\\src\\components\\dashboard\\NetWorthChart.tsx"
target_fingerprint: "sha256:41bee8a939f5341b909e20aa5a6b4bf97b35bcf9845c65d45031a6ef4f7c9726"
target_path: "C:\\Users\\biker\\projects\\gnucash-web\\src\\components\\dashboard\\NetWorthChart.tsx"
timestamp: 2026-11-17T17-52-20Z
slug: src-components-dashboard-networthchart-tsx
---
Method: dual-agent (A: design review · B: detector + browser evidence)

Target: dashboard "Net Worth Over Time" (src/components/dashboard/NetWorthChart.tsx) and "Cash flow by month" (src/components/charts/CashFlowChart.tsx), inside ExpandableChart.

## Heuristics (9 scored, help/recovery n/a for error recovery)
1 Status 2 (no headline figure; future Dec drawn at $0; partial Nov unmarked)
2 Real world 1 (rising debt drawn as a falling red line; "Jan 26" reads as a date; "$-7k")
3 Control 3
4 Consistency 1 (two charts disagree on tick format, tooltip font, height, legend; neither uses CHART_THEME)
5 Misreading prevention 2 (dual-axis crossovers; "$13k" tick is $13,333)
6 Recognition 2
7 Efficiency 2 (no drill from a month; period only in modal)
8 Minimalist 1 (two-way dashed grid, dashes on 3 of 5 series, smoothed monthly areas, muddy fills)
9 Error recovery n/a
10 Help 2
Total 16/36

## Priority issues
- [P1] Net worth: dual axis with liabilities as a negative red line on an inverted right axis. Fix: single hero line + header figure; assets and debt (positive, neutral colour) as small multiples on toggle. NetWorthChart.tsx:186-196, 276-289, 332.
- [P1] Cash flow: smoothed overlapping areas for monthly totals; future month and missing data drawn as $0. Fix: diverging bars (income up, expenses down) with a net tick per month; clip future; null for gaps; current month marked "to date". CashFlowChart.tsx:181-207; dashboard/page.tsx:112-114.
- [P1] Cash flow y-axis: no fitted domain, toFixed(0) rounding gives "$7k"/"$13k" for 6,667/13,333 and "$-7k" sign order. Fix: fitDomain incl. 0 + one shared compact currency formatter. CashFlowChart.tsx:24-32, 165-172.
- [P2] Not on CHART_THEME: two-way dashed grid, 12px secondary ticks, default #ccc cursor, bg-background tooltips, cash-flow tooltip not mono. Fix: CHART_THEME, horizontal solid grid, token cursor, one shared ChartTooltip.
- [P2] Expand modal: card inside card, duplicate title, net-worth legend falls onto the border, cash flow fixed 500px leaves empty space. ExpandableChart.tsx:102; NetWorthChart.tsx:235,251; CashFlowChart.tsx:149.
- [P2] Accessibility: expand button focusable at opacity 0 (ExpandableChart.tsx:57); svg role=application with no name; legend toggles mouse-only; "Same scale" pill rounded-full with no focus ring.
- [P3] Phone: net worth plot 148px wide (two 70px axes). Animation replays on every toggle. Heights 350 vs 300. Title case differs.

## Detector
CLI: 0 findings on all three files. Browser overlay: 0 findings inside the chart cards (detector does not inspect SVG text/strokes); page-level skipped-heading only.
Measured: all series colours are tokens (no raw hex); tick contrast 6.6:1 dark; light income stroke #16a34a 3.3:1 on white; grid 1.2-1.3:1 (fine for gridlines).
