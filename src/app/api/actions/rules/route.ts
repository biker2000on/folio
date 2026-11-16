import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import {
  ACTION_RULES,
  isKnownRuleId,
  isRuleEnabled,
  type RuleOverrides,
} from '@/lib/financial-actions/rules';
import { getRuleOverrides, setRulesEnabled } from '@/lib/financial-actions/rule-settings';
import { countOpenActionsByRule } from '@/lib/financial-actions/store';

export interface ActionRuleStatus {
  id: string;
  label: string;
  description: string;
  section: string;
  lane: string;
  enabled: boolean;
  /** Open items this rule currently produces, whether or not it is switched on. */
  openCount: number;
}

async function ruleStatuses(userId: number, bookGuid: string, overrides: RuleOverrides): Promise<ActionRuleStatus[]> {
  const counts = await countOpenActionsByRule({ userId, bookGuid });
  return ACTION_RULES.map(rule => ({
    id: rule.id,
    label: rule.label,
    description: rule.description,
    section: rule.section,
    lane: rule.lane,
    enabled: isRuleEnabled(rule.id, overrides),
    openCount: counts.get(rule.id) ?? 0,
  }));
}

/** Every Action Center rule for the active book, with its switch and current item count. */
export async function GET() {
  try {
    const roleResult = await requireRole('readonly');
    if (roleResult instanceof NextResponse) return roleResult;
    const overrides = await getRuleOverrides(roleResult.user.id, roleResult.bookGuid);
    return NextResponse.json({
      rules: await ruleStatuses(roleResult.user.id, roleResult.bookGuid, overrides),
    });
  } catch (error) {
    console.error('Error loading Action Center rules:', error);
    return NextResponse.json({ error: 'Failed to load Action Center rules' }, { status: 500 });
  }
}

/** Switch rules on or off: `{ changes: { "<ruleId>": boolean } }`. */
export async function PUT(request: NextRequest) {
  try {
    const roleResult = await requireRole('edit');
    if (roleResult instanceof NextResponse) return roleResult;
    const body = await request.json().catch(() => null) as { changes?: unknown } | null;
    const changes = body?.changes;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      return NextResponse.json({ error: 'changes must map rule ids to true or false' }, { status: 400 });
    }
    const entries = Object.entries(changes as Record<string, unknown>);
    if (entries.length === 0 || !entries.every(([id, enabled]) => isKnownRuleId(id) && typeof enabled === 'boolean')) {
      return NextResponse.json({ error: 'changes must map known rule ids to true or false' }, { status: 400 });
    }
    const overrides = await setRulesEnabled(
      roleResult.user.id,
      roleResult.bookGuid,
      Object.fromEntries(entries) as RuleOverrides,
    );
    return NextResponse.json({
      rules: await ruleStatuses(roleResult.user.id, roleResult.bookGuid, overrides),
    });
  } catch (error) {
    console.error('Error updating Action Center rules:', error);
    return NextResponse.json({ error: 'Failed to update Action Center rules' }, { status: 500 });
  }
}
