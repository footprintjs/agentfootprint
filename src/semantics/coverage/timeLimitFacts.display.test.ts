import { expect, it } from 'vitest';
import { timeLimitFactsOf, type TimeLimitsAudience } from './timeLimitFacts.js';

const clock = (turn: number, viewerZone?: string) => ({
  kind: 'clock',
  turn,
  zone: turn === 1 ? 'America/Los_Angeles' : 'Europe/London',
  zoneSource: 'run',
  ...(viewerZone !== undefined && { display: { purpose: 'display-only', viewerZone } }),
});
const period = (turn: number) => ({ kind: 'period', turn, shifted: true });

for (const audience of ['person', 'model'] satisfies TimeLimitsAudience[]) {
  it.each([
    {
      name: 'keeps the earlier declared viewer',
      first: 'America/New_York',
      selected: 1,
      expected: 'America/New_York',
    },
    {
      name: 'does not opt an earlier viewer in',
      first: undefined,
      selected: 1,
      expected: undefined,
    },
    {
      name: 'keeps an explicitly selected latest viewer',
      first: 'America/New_York',
      selected: 2,
      expected: 'UTC',
    },
  ])(`${audience}: $name`, ({ first, selected, expected }) => {
    const ledger = [clock(1, first), period(1), clock(2, 'UTC'), period(2)];
    const facts = timeLimitFactsOf(ledger, selected, audience);
    expect(facts).toBeDefined();
    expect(facts?.period).toEqual([period(selected)]);
    // Existing interpretation-zone policy is independent of display selection.
    expect(facts?.zone).toBe('Europe/London');
    if (expected === undefined) expect(facts).not.toHaveProperty('display');
    else expect(facts?.display).toEqual({ purpose: 'display-only', viewerZone: expected });
  });

  it(`${audience}: an omitted turn retains the existing all-row/default display behavior`, () => {
    const ledger = [clock(1, 'America/New_York'), period(1), clock(2, 'UTC'), period(2)];
    const facts = timeLimitFactsOf(ledger, undefined, audience);
    expect(facts?.period).toEqual([period(1), period(2)]);
    expect(facts?.zone).toBe('Europe/London');
    expect(facts?.display).toEqual({ purpose: 'display-only', viewerZone: 'UTC' });
  });
}
