// src/lib/ai-privacy/session.ts

/**
 * One gated model session: the level it runs at, the names map (summary only)
 * and the helpers a gated path needs. Built by openGatedAi() in ./gate.ts;
 * exported separately so pure call sites and tests can construct one without
 * a database.
 *
 * Every gated path sends its messages through session.chat(). In summary mode
 * chat() runs one last mask() over user/assistant content as a safety net, so
 * a real name that slipped past a summary builder is still replaced.
 */

import type { AiConfig } from '@/lib/receipt-extraction';
import { chatComplete, type AiChatMessage } from '@/lib/ai-query/client';
import { mask, ph, scrubRows, scrubText, unmask, unmaskSql, type Names, type TokenKind } from './privacy';

/** Every gated analysis path. Keep in step with AI_GATED_MODULES in ./registry.ts. */
export type GatedAiPath = 'ask' | 'digest-narrative' | 'insights-polish' | 'rule-suggest' | 'budget-suggest';

export type ChatFn = (
    config: AiConfig,
    messages: AiChatMessage[],
    opts?: { maxTokens?: number; timeoutMs?: number },
) => Promise<string>;

export interface GatedAi {
    readonly path: GatedAiPath;
    readonly level: 'summary' | 'full';
    /** The names map in summary mode; null in full mode. Server memory only. */
    readonly names: Names | null;
    /** Send messages to the configured endpoint. */
    chat(messages: AiChatMessage[], opts?: { maxTokens?: number; timeoutMs?: number }): Promise<string>;
    /** Known real names to tokens (identity in full mode). */
    mask(text: string): string;
    /** mask() plus rounded money and YYYY-MM dates (identity in full mode). */
    scrubText(text: string): string;
    /** Tokens back to real names (identity in full mode). */
    unmask(text: string): string;
    /** Tokens in model SQL to quoted real names (identity in full mode). */
    unmaskSql(sql: string): string;
    /** Result rows summarised for the model (identity in full mode). */
    scrubRows(rows: ReadonlyArray<Record<string, unknown>>): Record<string, unknown>[];
    /** The token for a real name (the name itself in full mode). */
    token(kind: TokenKind, real: string): string;
}

export function createGatedAi(opts: {
    path: GatedAiPath;
    level: 'summary' | 'full';
    config: AiConfig;
    names: Names | null;
    /** Injectable for tests; defaults to the real OpenAI-compatible client. */
    chatFn?: ChatFn;
}): GatedAi {
    const { path, level, config } = opts;
    const chatFn = opts.chatFn ?? chatComplete;
    if (level === 'full') {
        return {
            path,
            level,
            names: null,
            chat: (messages, o) => chatFn(config, messages, o),
            mask: t => t,
            scrubText: t => t,
            unmask: t => t,
            unmaskSql: s => s,
            scrubRows: rows => rows.map(r => ({ ...r })),
            token: (_k, real) => real,
        };
    }
    const names = opts.names;
    if (!names) throw new Error('A summary-mode AI session needs a names map');
    return {
        path,
        level,
        names,
        chat: (messages, o) => chatFn(
            config,
            messages.map(m => (m.role === 'system' ? m : { role: m.role, content: mask(m.content, names) })),
            o,
        ),
        mask: t => mask(t, names),
        scrubText: t => scrubText(t, names),
        unmask: t => unmask(t, names),
        unmaskSql: s => unmaskSql(s, names),
        scrubRows: rows => scrubRows(rows, names),
        token: (kind, real) => ph(names, kind, real),
    };
}
