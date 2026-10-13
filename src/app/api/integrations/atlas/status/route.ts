import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getAtlasStatus } from '@/lib/integrations/atlas-status';

export const dynamic = 'force-dynamic';

/**
 * @swagger
 * /api/integrations/atlas/status:
 *   get:
 *     summary: Atlas sync status for the active book (linked transactions, pending deletions, this user's tokens)
 */
export async function GET() {
  const roleResult = await requireRole('readonly');
  if (roleResult instanceof NextResponse) return roleResult;
  // Token callers use /api/integrations/beez/status; this one is for the UI.
  if (roleResult.viaToken) {
    return NextResponse.json({ error: 'Session required' }, { status: 403 });
  }
  try {
    return NextResponse.json(await getAtlasStatus(roleResult.user.id, roleResult.bookGuid));
  } catch (error) {
    console.error('Error loading Atlas status:', error);
    return NextResponse.json({ error: 'Failed to load Atlas status' }, { status: 500 });
  }
}
