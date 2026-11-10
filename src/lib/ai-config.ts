// src/lib/ai-config.ts

import crypto from 'crypto';
import { query } from './db';
import type { AiConfig } from './receipt-extraction';
import { isLikelySelfHostedUrl, parsePrivacyMode, type PrivacyMode } from './ai-privacy/privacy';

const ALGORITHM = 'aes-256-cbc';

function getEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET || '';
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text: string): string | null {
  try {
    const [ivHex, encHex] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return null; // Key changed or corrupted — user needs to re-enter
  }
}

/** The AI config in use plus the user's AI privacy choice (see src/lib/ai-privacy). */
export interface AiConfigWithPrivacy {
  config: AiConfig | null;
  /** Off / summary / full. Defaults to summary, including rows saved before the setting existed. */
  privacyMode: PrivacyMode;
  /** The user's "runs on my own hardware" flag for the endpoint in use. */
  selfHosted: boolean;
}

/**
 * Resolve the AI config for a user (DB first, env vars as fallback) together
 * with the privacy mode. Gated analysis paths must go through
 * src/lib/ai-privacy/gate.ts, which calls this; document-extraction paths keep
 * calling getAiConfig() and ignore the privacy mode.
 *
 * The privacy mode is read from the user's row even when that row is disabled
 * and the env config is in use, so "Off" sticks. The self-hosted flag belongs
 * to the row's own endpoint; the env endpoint uses AI_SELF_HOSTED=true.
 */
export async function getAiConfigWithPrivacy(userId: number): Promise<AiConfigWithPrivacy> {
  const result = await query(
    'SELECT * FROM gnucash_web_ai_config WHERE user_id = $1',
    [userId]
  );
  const row = result.rows[0];
  const privacyMode = parsePrivacyMode(row?.privacy_mode);

  if (row && row.enabled) {
    const apiKey = row.api_key_encrypted ? decrypt(row.api_key_encrypted) : null;
    return {
      config: {
        provider: row.provider,
        base_url: row.base_url,
        api_key: apiKey,
        model: row.model,
        enabled: row.enabled,
      },
      privacyMode,
      selfHosted: row.self_hosted === true,
    };
  }

  // Fall back to env vars
  const envKey = process.env.AI_API_KEY;
  const envBaseUrl = process.env.AI_BASE_URL;
  const envModel = process.env.AI_MODEL;

  if (envBaseUrl && envModel) {
    return {
      config: {
        provider: 'custom',
        base_url: envBaseUrl,
        api_key: envKey || null,
        model: envModel,
        enabled: true,
      },
      privacyMode,
      selfHosted: process.env.AI_SELF_HOSTED === 'true',
    };
  }

  return { config: null, privacyMode, selfHosted: false };
}

/**
 * Get AI config for a user. Checks DB first, falls back to env vars.
 * Ignores the privacy mode: only document-extraction paths (exempt, see
 * src/lib/ai-privacy/registry.ts) may call this directly.
 */
export async function getAiConfig(userId: number): Promise<AiConfig | null> {
  return (await getAiConfigWithPrivacy(userId)).config;
}

/** Save AI config for a user. */
export async function saveAiConfig(
  userId: number,
  config: {
    provider: string;
    base_url: string | null;
    /** A new key; `undefined` keeps the saved one, `null` clears it. */
    api_key: string | null | undefined;
    model: string | null;
    enabled: boolean;
    privacy_mode?: PrivacyMode;
    self_hosted?: boolean;
  }
): Promise<void> {
  const keepKey = config.api_key === undefined;
  const encryptedKey = config.api_key ? encrypt(config.api_key) : null;
  const privacyMode = parsePrivacyMode(config.privacy_mode);
  const selfHosted = config.self_hosted === true;

  await query(
    `INSERT INTO gnucash_web_ai_config (user_id, provider, base_url, api_key_encrypted, model, enabled, privacy_mode, self_hosted, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $8, $9, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       provider = EXCLUDED.provider,
       base_url = EXCLUDED.base_url,
       api_key_encrypted = CASE WHEN $7::boolean THEN gnucash_web_ai_config.api_key_encrypted ELSE EXCLUDED.api_key_encrypted END,
       model = EXCLUDED.model,
       enabled = EXCLUDED.enabled,
       privacy_mode = EXCLUDED.privacy_mode,
       self_hosted = EXCLUDED.self_hosted,
       updated_at = NOW()`,
    [userId, config.provider, config.base_url, encryptedKey, config.model, config.enabled, keepKey, privacyMode, selfHosted]
  );
}

/** Get AI config for display (redacts API key). */
export async function getAiConfigForDisplay(userId: number): Promise<{
  provider: string;
  base_url: string | null;
  has_api_key: boolean;
  api_key_valid: boolean;
  model: string | null;
  enabled: boolean;
  privacy_mode: PrivacyMode;
  self_hosted: boolean;
  /** What the base_url heuristic suggests for the self-hosted checkbox. */
  self_hosted_suggested: boolean;
} | null> {
  const result = await query(
    'SELECT * FROM gnucash_web_ai_config WHERE user_id = $1',
    [userId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const hasKey = !!row.api_key_encrypted;
  const keyValid = hasKey ? decrypt(row.api_key_encrypted) !== null : true;

  return {
    provider: row.provider,
    base_url: row.base_url,
    has_api_key: hasKey,
    api_key_valid: keyValid,
    model: row.model,
    enabled: row.enabled,
    privacy_mode: parsePrivacyMode(row.privacy_mode),
    self_hosted: row.self_hosted === true,
    self_hosted_suggested: isLikelySelfHostedUrl(row.base_url),
  };
}
