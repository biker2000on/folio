---
target: Household Documents, Utilities & Solar, and Planning → Home & Vehicles pages
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 6
target_identity: "file:C:\\Users\\biker\\projects\\gnucash-web\\src\\components\\resilience\\UtilitiesPage.tsx"
target_fingerprint: "sha256:3fb1039f9d6e2df05308dce6bf0fe10c3c335e5ea1041be588d42978ebd5ba54"
target_path: "C:\\Users\\biker\\projects\\gnucash-web\\src\\components\\resilience\\UtilitiesPage.tsx"
timestamp: 2026-11-06T13-54-29Z
slug: src-components-resilience-utilitiespage-tsx
---
# Critique: Planning → Home & Vehicles (6 pages)
Pages: Household Documents (/business/documents), Utilities & Solar (/planning/utilities), Home Inventory, Home Maintenance, Vehicle Total Cost, Mileage Log.
Method: dual-agent (A design review · B detector/overlay)

## Scores
| Page | Total |
|---|---|
| Utilities & Solar | 28/40 |
| Household Documents | 27/40 |
| Home Inventory | 26/40 |
| Home Maintenance | 22/40 |
| Mileage Log | 21/40 |
| Vehicle TCO | 19/40 |
| Section | 22/40 (Acceptable) |
Section heuristics: H1 2, H2 3, H3 2, H4 1, H5 3, H6 3, H7 2, H8 2, H9 2, H10 2.

## Priority issues
1. [P1] Unparsed uploads vanish silently (Utilities): poll times out to "No bills waiting for review" — UtilitiesPage.tsx:384-399, 539-543. Fix: track uploaded receipt ids; after timeout list the ones that produced no bill, with View receipt + Add manually. /impeccable harden
2. [P1] Failed section load leaves an empty, saveable buffer (Utilities, Vehicle TCO; Mileage renders blank) — P3FeaturePages.tsx:59-60. Fix: error panel + Retry, disable Add/Save until first load, Discard on every SaveBar. /impeccable harden
3. [P1] False-positive status: Solar "1 years" payback in green on $0 inputs (UtilitiesPage.tsx:569, p3-core calculateSolarPayback); green $0.00 deduction on Mileage. Fix: "—" + hint until inputs exist; tone only when non-zero; pluralize. /impeccable harden
4. [P1] Two design systems in one section: home-shared.tsx:24-26 fourth input recipe (DESIGN.md ban), hand-rolled Maintenance tabs (725-751), double gutters (resilience pages add max-w/p-4 inside Layout's p-4 md:p-8), mixed save models, sidebar names ≠ page titles. /impeccable polish
5. [P1] Maintenance wall of links: 5 actions × 10 rows, "never done"/"Never done" twice, un-baselined tasks filed under "Due soon" in warning color, 10px headings, ~20px mobile targets — maintenance/page.tsx:83, 487, 501-557, 802. /impeccable distill
6. [P1] Mileage Log not mobile-first: top-anchored Log trip enabled with no vehicle, trips as open 6-field forms defaulting to Schedule F, odometer fields never rendered, 16px-tall Remove targets, hard-coded "July 1" rate note — mileage/page.tsx:76-91,176,196-234. /impeccable adapt
7. [P2] Vehicle TCO: 13 ungrouped inputs, dead-end KPI tiles, decision buried, text-negative on Remove — P3FeaturePages.tsx:544-554. /impeccable layout
8. [P2] Documents empty state has no CTA; drop zone is a non-focusable div — documents/page.tsx:736-758,1086-1100. Use FileDropZone. /impeccable onboard

## Detector
CLI clean on all targets. Overlay: 6 findings — straggler ×3 (PageHeader subtitle; fix once with text-wrap: pretty), nested-cards ×1 (drop zone in panel; false positive), undersized-ui-text ×2 (Maintenance 10px group headings; real).
