# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary (in-app):** the owner, a single power user running their household and small-business books, plus people they invite to their instance (partner with edit access, accountant with read-only access).
- **Primary (marketing site):** self-hosters evaluating Folio from GitHub (github.com/biker2000on/folio) — GnuCash desktop users and homelab people deciding whether to deploy it on their own hardware. Technical, skeptical of hype, used to reading READMEs and Docker compose files.

## Product Purpose

Folio is a self-hosted personal and small-business finance platform: real double-entry accounting served from the user's own PostgreSQL database, with investments (lots, cost basis, tax harvesting), taxes, budgets, planning, business operations (AR/AP, Schedule C/F, 1099, nonprofit), and family-office consolidation layered on the same ledger. Success on the marketing site is a qualified self-hoster understanding what Folio is and moving to the getting-started docs / GitHub to deploy it.

## Positioning

**You own the ledger.** Folio runs as one Docker image against your PostgreSQL; the data never lives with a vendor. Amounts are exact fractions rather than floats, and optional connectors (SimpleFin, AI providers, S3) are explicit opt-ins. Monarch, YNAB, and Copilot cannot truthfully claim any of this.

Secondary differentiators (true, supporting): every important number can explain itself back to source transactions; household and business books live in one system.

## Operating Context

- Deployed via Docker on the owner's own server (e.g. TrueNAS); PWA on phone and desktop.
- Evaluators arrive from GitHub or a link, read the homepage, `/features`, and `/docs`, then decide to deploy.
- The logged-out site lives at `/`, `/features`, `/features/[slug]`; `/docs` is the documentation surface. Logged-in visitors to `/` are redirected into the app.

## Capabilities and Constraints

- Feature count, report count, and tool count on marketing pages are computed from `src/lib/feature-registry.ts`; never hard-code them.
- Feature-page content is data in `src/lib/marketing-content.ts`.
- Undecided: pricing, licensing terms for others, hosted offering. Do not imply a hosted/SaaS product or sign-up flow — the CTA for evaluators is docs/GitHub; "Sign in" is for existing instance users.
- Marketing copy names GnuCash only as an import source ("imports GnuCash files"); never as an identity, descriptor, or compatibility claim (owner decision, 2026-10-15). Wherever it is named, the footer carries the trademark / non-affiliation line.

## Brand Commitments

- Name: **Folio** (no descriptor). Logo: `src/components/brand/BrandMark.tsx` / `BrandLockup.tsx`.
- Voice: precise, plain, unhyped; claims are checkable.

## Evidence on Hand

- Real product: live feature registry, docs, README feature list, GitHub repo (github.com/biker2000on/gnucash-web).
- Stock photos in `public/marketing/` (Unsplash).
- No testimonials, customer logos, user counts, benchmarks, or press. Never fabricate them. Product screenshots/ledger demos must use synthetic data, labeled as such where it could be mistaken for real.

## Product Principles

1. The ledger is the source of truth; every surface reads the same double-entry data.
2. Ownership is verifiable, not promised: show the mechanism (your Postgres, your files, portable XML round-trip).
3. Precision over polish: exact fractions, honest uncertainty, explainable numbers.
4. Nothing hidden: automation is previewed, approved, audited, and reversible where possible.
