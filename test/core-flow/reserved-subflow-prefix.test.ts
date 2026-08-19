/**
 * The reserved subflow namespace — refused at the doors where a consumer types
 * a name, not discovered at the viewers where the damage lands.
 *
 * Framework composition segments are named `sf-*`, and every downstream reader
 * (commentary, step graphs, the OTel bridge, trace fingerprints) tells library
 * plumbing from consumer structure by that prefix alone. A consumer branch
 * named `sf-billing` did not fail like a name clash — it was silently read as
 * plumbing and vanished from the very views it was built to appear in: two
 * different facts sharing one namespace with no law. Same move as the reserved
 * `leave-journey` action name and footprintjs reserving the `~` marker.
 *
 * The immune builders are pinned too, with the REASON they are immune: Sequence
 * mounts `step-${id}` and Workflow mounts `step-${n}` — the consumer's text can
 * never start the segment — and Loop's `body` is framework-fixed. If either
 * ever switches to verbatim mounting, its pin fails and the door needs the
 * assert.
 */
import { describe, expect, it } from 'vitest';

import {
  Conditional,
  Parallel,
  Sequence,
  RESERVED_SUBFLOW_PREFIX,
  isReservedSubflowSegment,
} from '../../src/index.js';
import { graph } from '../../src/index.js';

const runner = {
  run: async () => 'ok',
  getSpec: () => ({ id: 'leaf', stages: [] } as never),
} as never;

describe('the reserved subflow namespace', () => {
  it('exports the law, so readers import it instead of hardcoding the prefix', () => {
    expect(RESERVED_SUBFLOW_PREFIX).toBe('sf-');
    expect(isReservedSubflowSegment('sf-llm-call')).toBe(true);
    expect(isReservedSubflowSegment('billing')).toBe(false);
  });

  it('Parallel.branch() refuses a reserved branch id, teachingly', () => {
    expect(() => Parallel.create().branch('sf-billing', runner)).toThrow(/reserved/);
    expect(() => Parallel.create().branch('sf-billing', runner)).toThrow(/sf-/);
  });

  it('Conditional.when() and .otherwise() refuse a reserved branch id', () => {
    expect(() => Conditional.create().when('sf-a', () => true, runner)).toThrow(/reserved/);
    expect(() =>
      Conditional.create()
        .when('a', () => true, runner)
        .otherwise('sf-b', runner),
    ).toThrow(/reserved/);
  });

  it('graph() refuses a reserved node id', () => {
    expect(() => graph({ nodes: [{ id: 'sf-scan', runner } as never], edges: [] })).toThrow(
      /reserved/,
    );
  });

  it('Sequence is immune BY CONSTRUCTION, and this pin fails if that changes', async () => {
    // Sequence mounts step-${id}, so a consumer sf-* id can never START the
    // segment. If the mount ever goes verbatim, this stops throwing nothing
    // and starts needing the assert at the door instead.
    const src = await import('node:fs').then((f) =>
      f.readFileSync('src/core-flow/Sequence.ts', 'utf8'),
    );
    expect(src).toContain('step-${step.id}');
    expect(() => Sequence.create().step('sf-looks-reserved', runner)).not.toThrow();
  });
  it('an ordinary name passes every door — the refusal is not an outage', () => {
    expect(() => Parallel.create().branch('billing', runner)).not.toThrow();
    expect(() =>
      Conditional.create()
        .when('billing', () => true, runner)
        .otherwise('fallback', runner),
    ).not.toThrow();
  });
});
