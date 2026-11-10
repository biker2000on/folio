// src/app/api/settings/ai/test/route.ts

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { extractReceiptData } from '@/lib/receipt-extraction';
import { getAiConfig } from '@/lib/ai-config';

export async function POST(request: Request) {
  try {
    const roleResult = await requireRole('admin');
    if (roleResult instanceof NextResponse) return roleResult;

    const body = await request.json();
    const { provider, base_url, api_key, model } = body;

    if (!base_url || !model) {
      return NextResponse.json({ error: 'base_url and model are required' }, { status: 400 });
    }

    const sampleText = 'COSTCO WHOLESALE #482\n123 Main St, Anytown USA\n03/15/2026\nKIRKLAND MILK 2% $4.99\nKS BREAD WHT $3.49\nTAX $0.68\nTOTAL $9.16';

    // A blank key in the form means "use the saved one", but only for the
    // saved endpoint: a saved key is never sent to a different address.
    const saved = api_key ? null : await getAiConfig(roleResult.user.id);
    const savedKey = saved && saved.base_url === base_url ? saved.api_key : null;

    const result = await extractReceiptData(sampleText, {
      provider, base_url, api_key: api_key || savedKey, model, enabled: true,
    });

    return NextResponse.json({
      success: true,
      extraction_method: result.extraction_method,
      extracted: { amount: result.amount, date: result.date, vendor: result.vendor },
    });
  } catch (error) {
    console.error('AI test error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Connection test failed',
    }, { status: 500 });
  }
}
