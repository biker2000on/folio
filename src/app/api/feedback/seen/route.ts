import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { markFeedbackResolutionSeen } from '@/lib/services/feedback.service';

export const dynamic = 'force-dynamic';

/**
 * @swagger
 * /api/feedback/seen:
 *   post:
 *     summary: Acknowledge "your feedback was resolved" notices (no ids = all of them)
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const rawIds: unknown = body?.ids ?? [];
  if (!Array.isArray(rawIds) || rawIds.length > 500 || !rawIds.every((id) => Number.isInteger(id) && id > 0)) {
    return NextResponse.json({ error: 'ids must be an array of feedback ids' }, { status: 400 });
  }
  try {
    await markFeedbackResolutionSeen(auth.user.id, rawIds as number[]);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Error marking feedback seen:', error);
    return NextResponse.json({ error: 'Failed to update feedback' }, { status: 500 });
  }
}
