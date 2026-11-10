// src/app/api/settings/ai/route.ts

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getAiConfigForDisplay, saveAiConfig } from '@/lib/ai-config';
import { DEFAULT_PRIVACY_MODE, PRIVACY_MODES, type PrivacyMode } from '@/lib/ai-privacy/privacy';

export async function GET() {
  try {
    const roleResult = await requireRole('readonly');
    if (roleResult instanceof NextResponse) return roleResult;
    const { user } = roleResult;

    const config = await getAiConfigForDisplay(user.id);
    return NextResponse.json(config || {
      provider: 'none',
      base_url: null,
      has_api_key: false,
      api_key_valid: true,
      model: null,
      enabled: false,
      privacy_mode: DEFAULT_PRIVACY_MODE,
      self_hosted: false,
      self_hosted_suggested: false,
    });
  } catch (error) {
    console.error('AI config error:', error);
    return NextResponse.json({ error: 'Failed to get AI config' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const roleResult = await requireRole('admin');
    if (roleResult instanceof NextResponse) return roleResult;
    const { user } = roleResult;

    const body = await request.json();
    const { provider, base_url, api_key, clear_api_key, model, enabled, privacy_mode, self_hosted } = body;

    if (privacy_mode !== undefined && !PRIVACY_MODES.includes(privacy_mode)) {
      return NextResponse.json({ error: 'privacy_mode must be off, summary or full' }, { status: 400 });
    }
    if (self_hosted !== undefined && typeof self_hosted !== 'boolean') {
      return NextResponse.json({ error: 'self_hosted must be true or false' }, { status: 400 });
    }

    await saveAiConfig(user.id, {
      provider: provider || 'none',
      base_url: base_url || null,
      // A blank key keeps the saved one; clear_api_key removes it.
      api_key: clear_api_key === true ? null : (typeof api_key === 'string' && api_key.trim() ? api_key.trim() : undefined),
      model: model || null,
      enabled: enabled ?? false,
      privacy_mode: (privacy_mode as PrivacyMode | undefined) ?? DEFAULT_PRIVACY_MODE,
      self_hosted: self_hosted === true,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('AI config save error:', error);
    return NextResponse.json({ error: 'Failed to save AI config' }, { status: 500 });
  }
}
