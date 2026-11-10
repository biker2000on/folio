// src/lib/ai-privacy/gate.ts

/**
 * The one gate every AI analysis path goes through ("Ask your books", the
 * digest narrative, insight polish). See ./registry.ts for the full list and
 * for the document-extraction paths that are exempt.
 *
 *   off      openGatedAi() returns { ok: false, reason: 'off' } and no model is called
 *   summary  the default: a session whose helpers mask names, round money and
 *            reduce dates, and whose chat() masks once more as a safety net
 *   full     full detail, only for an endpoint the user marked as their own
 *            hardware (and not a known cloud provider). Otherwise summary.
 *
 * Placeholder maps live in this server's memory only, per set of accounts.
 * Never written to disk, never logged, never sent anywhere. Built in a fixed
 * order (accounts, then descriptions by spend, then commodities) and only ever
 * added to, so tokens stay stable across the calls of one answer. Reloaded at
 * most every 60 seconds; dropped after 30 idle minutes.
 */

import { createHash } from 'crypto';
import { getAiConfigWithPrivacy } from '@/lib/ai-config';
import { isAiConfigured } from '@/lib/ai-query/client';
import { loadNamesSource, type NamesSource } from './names-source';
import {
    externalLevel,
    isBankEvent,
    isGenericAccountName,
    levelFor,
    newNames,
    ph,
    type McpDetail,
    type Names,
    type PrivacyLevel,
} from './privacy';
import { createGatedAi, type GatedAi, type GatedAiPath } from './session';

export type { GatedAi, GatedAiPath } from './session';

const RELOAD_MS = 60_000;
const IDLE_MS = 30 * 60_000;

interface CacheEntry {
    names: Names;
    at: number;
    loaded: number;
    loading: Promise<void> | null;
}

const g = globalThis as unknown as { __folioAiNames?: Map<string, CacheEntry> };
const cache: Map<string, CacheEntry> = (g.__folioAiNames ??= new Map());

/** Add a book's names to a map in a fixed order. Pure; exported for tests. */
export function addNamesFromSource(names: Names, source: NamesSource): Names {
    for (const a of source.accounts) {
        if (a.name && !isGenericAccountName(a.name)) ph(names, 'Account', a.name);
        if (a.fullname && a.fullname !== a.name && !isGenericAccountName(a.fullname)) ph(names, 'Account', a.fullname);
    }
    for (const d of source.descriptions) {
        // Bank events ("Interest charged", "Transfer") get no placeholder: masking a common word mangles prose.
        if (d.description && !isBankEvent(d.description)) ph(names, 'Merchant', d.description);
    }
    for (const c of source.commodities) {
        if (c.mnemonic) ph(names, 'Holding', c.mnemonic);
        if (c.fullname && c.fullname !== c.mnemonic) ph(names, 'Holding', c.fullname);
    }
    return names;
}

function cacheKey(accountGuids: readonly string[]): string {
    return createHash('sha256').update([...accountGuids].map(s => s.toLowerCase()).sort().join(',')).digest('hex');
}

/** The names map for a set of accounts, from server memory (reloaded at most every 60s). */
export async function namesFor(accountGuids: readonly string[]): Promise<Names> {
    const now = Date.now();
    for (const [k, e] of cache) if (now - e.at > IDLE_MS) cache.delete(k);
    const k = cacheKey(accountGuids);
    let hit = cache.get(k);
    if (!hit) {
        hit = { names: newNames(), at: now, loaded: 0, loading: null };
        cache.set(k, hit);
    }
    hit.at = now;
    if (now - hit.loaded >= RELOAD_MS) {
        const entry = hit;
        entry.loading ??= loadNamesSource([...accountGuids])
            .then(source => {
                addNamesFromSource(entry.names, source);
                entry.loaded = Date.now();
            })
            .finally(() => {
                entry.loading = null;
            });
        await entry.loading;
    }
    return hit.names;
}

/** Drop every cached names map (tests, and after a book is deleted). */
export function clearNamesCache(): void {
    cache.clear();
}

export interface AiAvailability {
    /** An endpoint is configured (it may still be off for analysis). */
    configured: boolean;
    /** The level a gated call would run at; 'off' when not configured. */
    level: PrivacyLevel;
}

/** What a gated path would get for this user, without loading any names. */
export async function aiAvailability(userId: number): Promise<AiAvailability> {
    const { config, privacyMode, selfHosted } = await getAiConfigWithPrivacy(userId);
    if (!isAiConfigured(config)) return { configured: false, level: 'off' };
    return { configured: true, level: levelFor(privacyMode, selfHosted, config.base_url) };
}

export type OpenGatedAiResult =
    | { ok: true; ai: GatedAi }
    | { ok: false; reason: 'unconfigured' | 'off' };

/**
 * Open a session for one gated path. Resolves the user's config and privacy
 * mode; in summary mode builds (or reuses) the names map for the accounts the
 * payload draws on. Returns { ok: false } when nothing may be sent.
 */
export async function openGatedAi(opts: {
    userId: number;
    path: GatedAiPath;
    /** Accounts the payload draws on (book or family scope). */
    accountGuids: readonly string[] | (() => Promise<readonly string[]>);
}): Promise<OpenGatedAiResult> {
    const { config, privacyMode, selfHosted } = await getAiConfigWithPrivacy(opts.userId);
    if (!isAiConfigured(config)) return { ok: false, reason: 'unconfigured' };
    const level = levelFor(privacyMode, selfHosted, config.base_url);
    if (level === 'off') return { ok: false, reason: 'off' };
    if (level === 'full') return { ok: true, ai: createGatedAi({ path: opts.path, level, config, names: null }) };
    const guids = typeof opts.accountGuids === 'function' ? await opts.accountGuids() : opts.accountGuids;
    const names = await namesFor(guids);
    return { ok: true, ai: createGatedAi({ path: opts.path, level, config, names }) };
}

/* ------------------------------------------------------------------ */
/* External clients (MCP)                                              */
/* ------------------------------------------------------------------ */

/**
 * What an external client (the MCP server's caller) may see. Folio calls no
 * model here: the client's own model reads the tool results, so the gate only
 * decides the level and hands over the names map to scrub with.
 */
export type ExternalAccess =
    | { level: 'off'; names: null }
    | { level: 'full'; names: null }
    | { level: 'summary'; names: Names };

/**
 * Resolve the level for an external client: the stricter of the owner's AI
 * privacy mode and the requested detail (the token's MCP detail). Works
 * whether or not an AI endpoint is configured: the mode is the user's choice
 * about their data, not about Folio's own model.
 */
export async function openExternalAccess(opts: {
    userId: number;
    detail: McpDetail;
    accountGuids: readonly string[] | (() => Promise<readonly string[]>);
}): Promise<ExternalAccess> {
    const { privacyMode } = await getAiConfigWithPrivacy(opts.userId);
    const level = externalLevel(privacyMode, opts.detail);
    if (level === 'off') return { level: 'off', names: null };
    if (level === 'full') return { level: 'full', names: null };
    const guids = typeof opts.accountGuids === 'function' ? await opts.accountGuids() : opts.accountGuids;
    return { level: 'summary', names: await namesFor(guids) };
}
