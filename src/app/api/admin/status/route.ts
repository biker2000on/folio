import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { feedbackStatusCounts, isFeedbackAdmin } from '@/lib/services/feedback.service';

export const dynamic = 'force-dynamic';

/**
 * @swagger
 * /api/admin/status:
 *   get:
 *     summary: Whether the signed-in user triages feedback, and how many reports are new
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  try {
    const admin = await isFeedbackAdmin(auth.user.id);
    if (!admin) return NextResponse.json({ admin: false });
    const counts = await feedbackStatusCounts();
    return NextResponse.json({ admin: true, feedback_new: counts.new });
  } catch (error) {
    console.error('Error checking admin status:', error);
    return NextResponse.json({ error: 'Failed to check access' }, { status: 500 });
  }
}
