import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { FEEDBACK_STATUSES, type FeedbackStatus } from '@/lib/feedback';
import {
  feedbackStatusCounts,
  isFeedbackAdmin,
  listAllFeedback,
  toPublic,
} from '@/lib/services/feedback.service';

export const dynamic = 'force-dynamic';

/**
 * @swagger
 * /api/admin/feedback:
 *   get:
 *     summary: Feedback inbox for operators (FEEDBACK_ADMIN_USERS), optionally filtered by ?status=
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const status = request.nextUrl.searchParams.get('status') || null;
  if (status && !FEEDBACK_STATUSES.includes(status as FeedbackStatus)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  try {
    if (!(await isFeedbackAdmin(auth.user.id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const [items, counts] = await Promise.all([
      listAllFeedback(status as FeedbackStatus | null),
      feedbackStatusCounts(),
    ]);
    return NextResponse.json({ items: items.map(toPublic), counts });
  } catch (error) {
    console.error('Error listing feedback inbox:', error);
    return NextResponse.json({ error: 'Failed to load feedback' }, { status: 500 });
  }
}
