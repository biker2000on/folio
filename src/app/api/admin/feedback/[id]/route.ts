import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { FEEDBACK_MAX_BODY, FEEDBACK_STATUSES, type FeedbackStatus } from '@/lib/feedback';
import { isFeedbackAdmin, toPublic, updateFeedbackTriage } from '@/lib/services/feedback.service';

export const dynamic = 'force-dynamic';

/**
 * @swagger
 * /api/admin/feedback/{id}:
 *   patch:
 *     summary: Triage a feedback item (status and/or a note shown to the submitter)
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid feedback id' }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const patch: { status?: FeedbackStatus; adminNote?: string } = {};
  if (body.status !== undefined) {
    if (!FEEDBACK_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.admin_note !== undefined) {
    if (typeof body.admin_note !== 'string') {
      return NextResponse.json({ error: 'admin_note must be a string' }, { status: 400 });
    }
    const note = body.admin_note.trim();
    if ([...note].length > FEEDBACK_MAX_BODY) {
      return NextResponse.json({ error: 'admin_note is too long' }, { status: 400 });
    }
    patch.adminNote = note;
  }

  try {
    if (!(await isFeedbackAdmin(auth.user.id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const updated = await updateFeedbackTriage(id, patch);
    if (!updated) return NextResponse.json({ error: 'Feedback not found' }, { status: 404 });
    return NextResponse.json(toPublic(updated));
  } catch (error) {
    console.error('Error updating feedback:', error);
    return NextResponse.json({ error: 'Failed to update feedback' }, { status: 500 });
  }
}
