import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  countRecentFeedback,
  createFeedback,
  FEEDBACK_MAX_REQUEST_BYTES,
  FEEDBACK_RATE_LIMIT,
  FeedbackValidationError,
  listUserFeedback,
  notifyFeedbackAdmins,
  toPublic,
  validateFeedback,
} from '@/lib/services/feedback.service';

export const dynamic = 'force-dynamic';

/**
 * @swagger
 * /api/feedback:
 *   get:
 *     summary: List the signed-in user's own feedback submissions, newest first
 *   post:
 *     summary: Send in-app feedback (kind, text, page context, optional screenshot data URL)
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  try {
    const items = await listUserFeedback(auth.user.id);
    return NextResponse.json({ items: items.map(toPublic) });
  } catch (error) {
    console.error('Error listing feedback:', error);
    return NextResponse.json({ error: 'Failed to load feedback' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > FEEDBACK_MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: 'Feedback is too large' }, { status: 413 });
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (Buffer.byteLength(text) > FEEDBACK_MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: 'Feedback is too large' }, { status: 413 });
  }

  try {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    const input = validateFeedback(raw);

    if (await countRecentFeedback(auth.user.id) >= FEEDBACK_RATE_LIMIT) {
      return NextResponse.json(
        { error: 'Too much feedback in the last hour; try again later' },
        { status: 429 },
      );
    }

    const item = await createFeedback(auth.user.id, input);
    notifyFeedbackAdmins(item, auth.user);
    return NextResponse.json(toPublic(item), { status: 201 });
  } catch (error) {
    if (error instanceof FeedbackValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error saving feedback:', error);
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 });
  }
}
