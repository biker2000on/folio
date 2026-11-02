/**
 * Page width tiers (DESIGN.md "Layout"). Pages that Layout leaves full-bleed
 * own their width with one of these; everything else gets the shell default.
 *
 * Kept as literal class strings so Tailwind's scanner sees them.
 */

/** Dashboards, reports, forms and section pages. */
export const CONTENT_MAX_WIDTH = 'max-w-[1400px]';

/** Registers scanned row by row: the account tree and the account ledgers. */
export const DATA_SURFACE_MAX_WIDTH = 'max-w-[1920px]';
