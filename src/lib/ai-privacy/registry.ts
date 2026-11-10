// src/lib/ai-privacy/registry.ts

/**
 * Every module that reaches an AI endpoint, classified.
 *
 * src/lib/ai-privacy/__tests__/registry.test.ts scans src/ for the AI-call
 * primitives (a `chatComplete` reference, a `getAiConfig(` call, a direct
 * `/chat/completions` URL) and fails when a module is in none of these lists.
 * A new AI path can't ship without someone deciding which one it belongs to.
 *
 *   core    the primitives themselves and the gate
 *   gated   analysis of the user's books. Goes through openGatedAi() in
 *           ./gate.ts and obeys the privacy mode (off / summary / full).
 *           Must not touch the primitives directly.
 *   exempt  extraction of a document or entry the user handed over, or
 *           public data. Keeps working whenever AI is configured, in every
 *           privacy mode, with no masking: rounding a receipt total or
 *           tokenising a payslip employer would corrupt the extraction.
 *
 * Paths are repo-relative with forward slashes.
 */

export const AI_CORE_MODULES: Readonly<Record<string, string>> = {
    'src/lib/ai-query/client.ts': 'Defines chatComplete, the OpenAI-compatible client.',
    'src/lib/ai-config.ts': 'Defines getAiConfig and getAiConfigWithPrivacy.',
    'src/lib/ai-privacy/gate.ts': 'The privacy gate: resolves the level and the names map.',
    'src/lib/ai-privacy/session.ts': 'A gated session; the only analysis caller of chatComplete.',
    'src/lib/ai-privacy/registry.ts': 'This registry; it names the primitives in its docs.',
};

export const AI_GATED_MODULES: Readonly<Record<string, string>> = {
    'src/app/api/ai/query/route.ts': 'Ask your books: opens the gate, unmasks SQL before the guardrails.',
    'src/lib/ai-query/generate.ts': 'Ask your books: SQL generation from a masked question.',
    'src/lib/ai-query/answer.ts': 'Ask your books: answer from scrubbed rows, number-checked.',
    'src/lib/digest-narrative.ts': 'Monthly digest narrative from a summarised payload, number-checked.',
    'src/lib/insights.ts': 'Insight title/detail polish, scrubbed per item, number-checked.',
};

export const AI_EXEMPT_MODULES: Readonly<Record<string, string>> = {
    'src/lib/receipt-extraction.ts': 'Receipt OCR text extraction (document extraction).',
    'src/lib/receipt-reextract.ts': 'Receipt re-extraction (document extraction).',
    'src/lib/queue/jobs/ocr-receipt.ts': 'Receipt OCR job (document extraction).',
    'src/app/api/receipts/reextract/route.ts': 'Receipt re-extraction route (document extraction).',
    'src/app/api/settings/ai/test/route.ts': 'Connection test with a fixed sample receipt; no user data.',
    'src/lib/payslip-extract-core.ts': 'Payslip extraction (document extraction).',
    'src/lib/payslip-extraction.ts': 'Payslip extraction (document extraction).',
    'src/lib/statement-ingest.ts': 'Statement import (document extraction).',
    'src/lib/statement-parse/ai-extract.ts': 'Statement parsing (document extraction).',
    'src/lib/documents/entity-extraction.ts': 'Document vault entity extraction (document extraction).',
    'src/lib/resilience/estate-parse.ts': 'Estate document parsing (document extraction).',
    'src/lib/resilience/insurance-parse.ts': 'Insurance policy parsing (document extraction).',
    'src/app/api/resilience/estate/parse/route.ts': 'Estate document parsing route (document extraction).',
    'src/app/api/resilience/insurance/parse/route.ts': 'Insurance policy parsing route (document extraction).',
    'src/app/api/ai/parse-transaction/route.ts': "Quick add: parses the user's own typed entry; rounding would corrupt it.",
    'src/app/api/contribution-limits/ai-fetch/route.ts': 'Fetches public IRS limits; sends no user data.',
};
