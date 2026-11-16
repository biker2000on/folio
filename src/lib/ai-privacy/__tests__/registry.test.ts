/**
 * Guard: every module that reaches an AI endpoint is classified in
 * src/lib/ai-privacy/registry.ts as core, gated or exempt. Adding a new AI
 * path without deciding whether it obeys the privacy mode fails here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_CORE_MODULES, AI_EXEMPT_MODULES, AI_EXTERNAL_MODULES, AI_GATED_MODULES } from '../registry';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

/** The AI-call primitives. A module matching any of these talks to a model. */
const PRIMITIVES: Array<{ name: string; re: RegExp }> = [
    { name: 'chatComplete', re: /\bchatComplete\b/ },
    { name: 'getAiConfig(', re: /\bgetAiConfig\s*\(/ },
    { name: 'getAiConfigWithPrivacy(', re: /\bgetAiConfigWithPrivacy\s*\(/ },
    { name: '/chat/completions', re: /\/chat\/completions/ },
];

function walk(dir: string, out: string[]): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
            walk(full, out);
        } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && !/\.(test|spec)\.[a-z]+$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');
const files = walk(SRC, []).map(f => ({ path: rel(f), text: fs.readFileSync(f, 'utf8') }));
const usesPrimitive = (text: string) => PRIMITIVES.filter(p => p.re.test(text)).map(p => p.name);

const core = Object.keys(AI_CORE_MODULES);
const gated = Object.keys(AI_GATED_MODULES);
const exempt = Object.keys(AI_EXEMPT_MODULES);
const external = Object.keys(AI_EXTERNAL_MODULES);

describe('AI module registry', () => {
    it('scans a real tree', () => {
        expect(files.length).toBeGreaterThan(100);
        expect(files.some(f => f.path === 'src/lib/ai-query/client.ts')).toBe(true);
    });

    it('classifies every module that uses an AI-call primitive', () => {
        const classified = new Set([...core, ...gated, ...exempt]);
        const unclassified = files
            .filter(f => usesPrimitive(f.text).length > 0 && !classified.has(f.path))
            .map(f => `${f.path} (${usesPrimitive(f.text).join(', ')})`);
        expect(
            unclassified,
            'Add these to AI_GATED_MODULES (and route them through openGatedAi) or to AI_EXEMPT_MODULES in src/lib/ai-privacy/registry.ts',
        ).toEqual([]);
    });

    it('lists only modules that exist, each in one list', () => {
        const all = [...core, ...gated, ...exempt, ...external];
        expect(all.filter(p => !fs.existsSync(path.join(ROOT, p)))).toEqual([]);
        expect(all.filter((p, i) => all.indexOf(p) !== i)).toEqual([]);
    });

    it('keeps gated modules off the primitives and on the gate', () => {
        for (const p of gated) {
            const text = fs.readFileSync(path.join(ROOT, p), 'utf8');
            expect(usesPrimitive(text), `${p} must call the model through the gate session, not directly`).toEqual([]);
            expect(text, `${p} must use src/lib/ai-privacy`).toMatch(/@\/lib\/ai-privacy\//);
        }
    });

    it('keeps external-client modules (MCP) on the gate and off the primitives', () => {
        expect(external.length).toBeGreaterThan(0);
        for (const p of external) {
            const text = fs.readFileSync(path.join(ROOT, p), 'utf8');
            expect(usesPrimitive(text), `${p} serves an external model and must not call one`).toEqual([]);
            expect(text, `${p} must use src/lib/ai-privacy`).toMatch(/@\/lib\/ai-privacy\//);
        }
        const shape = fs.readFileSync(path.join(ROOT, 'src/lib/mcp/shape.ts'), 'utf8');
        expect(shape, 'the MCP result hook must resolve the level through the gate').toMatch(/openExternalAccess/);
    });

    it('keeps exempt modules out of the gate (they ignore the privacy mode)', () => {
        for (const p of exempt) {
            const text = fs.readFileSync(path.join(ROOT, p), 'utf8');
            expect(text, `${p} is exempt and must not open the gate`).not.toMatch(/openGatedAi/);
        }
    });
});
