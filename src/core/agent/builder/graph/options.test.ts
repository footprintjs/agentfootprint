import { describe, expect, it } from 'vitest';

describe('skill-graph mount documentation', () => {
  it('STATED: the tool exemption is documented where the posture is declared', async () => {
    // The exemption is deliberate, but an author meets `strictness` at its
    // own definition site and nowhere else. If the door is left open, the
    // docstring there has to say so — a reader who mounts `'rails'` expecting
    // "nothing but my declared selection routes" is otherwise wrong on the
    // strength of what we wrote. This is the doc half of the decision, and it
    // is load-bearing enough to fail the suite when it goes missing.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./options.ts', import.meta.url), 'utf8');
    expect(src).toContain('A `propose-transition` tool effect. A proposal comes from a TOOL');
    expect(src).toContain('admitted under `assist`, `guard` AND');
  });
});
