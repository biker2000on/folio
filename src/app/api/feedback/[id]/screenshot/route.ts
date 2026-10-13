import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getFeedback, isFeedbackAdmin, readFeedbackScreenshot } from '@/lib/services/feedback.service';

export const dynamic = 'force-dynamic';

/**
 * @swagger
 * /api/feedback/{id}/screenshot:
 *   get:
 *     summary: The screenshot attached to a feedback item (its submitter or a feedback operator)
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid feedback id' }, { status: 400 });
  }
  try {
    const item = await getFeedback(id);
    // Someone else's report is "not found" unless you triage feedback.
    if (!item || (item.user_id !== auth.user.id && !(await isFeedbackAdmin(auth.user.id)))) {
      return NextResponse.json({ error: 'Feedback not found' }, { status: 404 });
    }
    const shot = await readFeedbackScreenshot(item);
    if (!shot) return NextResponse.json({ error: 'No screenshot' }, { status: 404 });
    return new Response(new Uint8Array(shot.data), {
      headers: {
        'Content-Type': shot.contentType,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Error serving feedback screenshot:', error);
    return NextResponse.json({ error: 'Failed to load screenshot' }, { status: 500 });
  }
}
