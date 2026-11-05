import { describe, expect, it } from 'vitest';
import { simpleFinLinkState, summarizeSimpleFinIssues } from '../simplefin-notices';

describe('summarizeSimpleFinIssues', () => {
  const upgrading = (bank: string) =>
    `all: Connection to ${bank} may need attention. We are upgrading this connection. Please wait...`;

  it('collapses the bridge repeating one notice per account and per chunk', () => {
    const text = [upgrading('Synchrony - Credit Cards'), upgrading('Synchrony - Credit Cards'), upgrading('Ally Bank Justin')].join('\n');
    const summary = summarizeSimpleFinIssues(text);
    expect(summary.institutions).toEqual(['Synchrony - Credit Cards', 'Ally Bank Justin']);
    expect(summary.other).toEqual([]);
    expect(summary.raw).toHaveLength(2);
    expect(summary.raw[0]).not.toMatch(/^all:/);
  });

  it('keeps anything that is not a per-bank notice as a real error', () => {
    const summary = summarizeSimpleFinIssues(`${upgrading('PNC Bank')}\nall: Failed to fetch from SimpleFin: timeout`);
    expect(summary.institutions).toEqual(['PNC Bank']);
    expect(summary.other).toEqual(['Failed to fetch from SimpleFin: timeout']);
  });

  it('is empty for no text', () => {
    expect(summarizeSimpleFinIssues(null)).toEqual({ institutions: [], other: [], raw: [] });
  });
});

describe('simpleFinLinkState', () => {
  it('distinguishes live, stale, undecided and ignored accounts', () => {
    expect(simpleFinLinkState({ isMapped: true, isLive: true })).toBe('linked');
    expect(simpleFinLinkState({ isMapped: true, isLive: false })).toBe('stale');
    expect(simpleFinLinkState({ isMapped: false, isLive: true })).toBe('unlinked');
    expect(simpleFinLinkState({ isMapped: false, isLive: true, isIgnored: true })).toBe('ignored');
  });
});
