import { describe, expect, it, vi } from 'vitest';
import * as envelopeReader from '../../../../../../semantics/toolEffects.js';
import type { ToolMiddleware } from '../../../../middleware/types.js';
import { sealToolEffectContent } from '../../../../../../semantics/sealedToolEffectContent.js';
import { captureReturnedEffectAuthority } from './authority.js';
import { observeEffectContent } from './settle.js';

const occurrence = [1, 2, 3, 4, 0] as const;
const effect = () => ({
  kind: 'require-instruction' as const,
  instructionId: 'fixture',
  deliveryLease: 'next-call' as const,
});

function fixture(count = 1) {
  const raw = { content: 'starting content', effects: Array.from({ length: count }, effect) };
  return { raw, authority: captureReturnedEffectAuthority(raw, occurrence) };
}

function policy(
  admitToolResultEffects: NonNullable<ToolMiddleware['admitToolResultEffects']>,
): ToolMiddleware {
  return { name: 'fixture', onToolResult: () => ({ kind: 'allow' }), admitToolResultEffects };
}

describe('bounded result effect proof', () => {
  it('charges slot count, status, and aggregate UTF-8 bytes before normalization', () => {
    const normalize = vi.spyOn(envelopeReader, 'readToolResultEnvelope');
    const content = 'inert fixture content';
    try {
      const { authority } = fixture(256);
      expect(authority?.envelope.effects).toHaveLength(256);
      expect(normalize).toHaveBeenCalledTimes(1);
      normalize.mockClear();

      const entries = Array.from({ length: 257 }, effect);
      const offLimits = vi.fn(effect);
      Object.defineProperty(entries, '0', { get: offLimits });
      expect(
        captureReturnedEffectAuthority({ content, effects: entries }, occurrence),
      ).toBeUndefined();
      expect(offLimits).not.toHaveBeenCalled();
      expect(
        captureReturnedEffectAuthority(
          {
            content,
            effects: [effect()],
            status: ' '.repeat(65_536) + 'success',
          },
          occurrence,
        ),
      ).toBeUndefined();
      expect(
        captureReturnedEffectAuthority(
          {
            content,
            effects: [{ ...effect(), instructionId: 'a'.repeat(65_537) }],
          },
          occurrence,
        ),
      ).toBeUndefined();
      const repeated = { ...effect(), instructionId: 'é'.repeat(17_000) };
      expect(
        captureReturnedEffectAuthority(
          {
            content,
            effects: [repeated, repeated],
          },
          occurrence,
        ),
      ).toBeUndefined();
      expect(normalize).not.toHaveBeenCalled();
    } finally {
      normalize.mockRestore();
    }
  });

  it('only inspects named own fields on the original value', () => {
    const raw = { content: 'inert fixture', effects: [effect()] };
    const ownKeys = vi.fn(() => []);
    const proxied = new Proxy(raw, { ownKeys });
    const keys = vi.spyOn(Object, 'keys');
    let captured;
    let enumeratedRaw = false;
    try {
      captured = captureReturnedEffectAuthority(raw, occurrence);
      enumeratedRaw = keys.mock.calls.some(([value]) => value === raw);
    } finally {
      keys.mockRestore();
    }
    expect(captured?.envelope.effects).toEqual([effect()]);
    expect(enumeratedRaw).toBe(false);
    expect(captureReturnedEffectAuthority(proxied, occurrence)).toBeUndefined();
    expect(ownKeys).not.toHaveBeenCalled();
  });

  it('preserves entry-time fields and withholds ordinary approval when observation changes', async () => {
    const { raw, authority } = fixture();
    const initial = sealToolEffectContent('{"fixture":{"ready":true}}');
    const untouched = observeEffectContent(authority, occurrence, initial);
    untouched.observe(initial, false);
    expect(await untouched.settle(initial, [], undefined)).toMatchObject({ effects: [effect()] });

    const changed = observeEffectContent(authority, occurrence, initial);
    raw.effects[0]!.instructionId = 'different fixture';
    changed.observe(initial, false);
    expect(await changed.settle(initial, [], undefined)).toBeNull();
    expect(
      await changed.settle(initial, [policy(({ proposals }) => proposals)], undefined),
    ).toMatchObject({ effects: [effect()] });
  });

  it('does not reflect on unowned values or grant after cumulative proof exhaustion', async () => {
    const { authority } = fixture();
    const ownKeys = vi.fn(() => []);
    const getPrototypeOf = vi.fn(() => null);
    const opaque = new Proxy({}, { ownKeys, getPrototypeOf });
    const approve = vi.fn(() => []);
    const governed = [policy(approve)];
    const uncertain = observeEffectContent(authority, occurrence, opaque);
    uncertain.observe(opaque, false);
    expect(await uncertain.settle(opaque, governed, undefined)).toBeNull();
    expect(approve).not.toHaveBeenCalled();
    expect(ownKeys).not.toHaveBeenCalled();
    expect(getPrototypeOf).not.toHaveBeenCalled();

    const large = 'x'.repeat(65_536);
    const exhausted = observeEffectContent(authority, occurrence, large);
    for (let boundary = 0; boundary < 4; boundary++) exhausted.observe(large, false);
    expect(await exhausted.settle(large, governed, undefined)).toBeNull();
    expect(approve).not.toHaveBeenCalled();
  });

  it('keeps the rewrite requirement after restoring the entry value', async () => {
    const { authority } = fixture();
    const proof = observeEffectContent(authority, occurrence, 'original');
    proof.observe('changed', true);
    proof.observe('original', true);
    expect(await proof.settle('original', [], undefined)).toBeNull();
  });

  it('bounds proposal and selection lists independently', async () => {
    const approve = vi.fn<NonNullable<ToolMiddleware['admitToolResultEffects']>>(
      ({ proposals }) => proposals,
    );
    const governed = [policy(approve)];
    for (const count of [64, 65]) {
      const { authority } = fixture(count);
      const proof = observeEffectContent(authority, occurrence, 'original');
      proof.observe('replacement', true);
      const admitted = await proof.settle('replacement', governed, undefined);
      if (count === 64) expect(admitted?.effects).toHaveLength(64);
      else expect(admitted).toBeNull();
    }
    expect(approve).toHaveBeenCalledTimes(1);

    const { authority } = fixture(64);
    const proof = observeEffectContent(authority, occurrence, 'original');
    proof.observe('replacement', true);
    expect(
      await proof.settle(
        'replacement',
        [policy(({ proposals }) => [...proposals, proposals[0]!])],
        undefined,
      ),
    ).toBeNull();
  });

  it('rejects duplicate, copied and past selections and missing call identity', async () => {
    const { authority } = fixture();
    const proof = observeEffectContent(authority, occurrence, 'original');
    proof.observe('replacement', true);
    let saved: ReturnType<NonNullable<ToolMiddleware['admitToolResultEffects']>> = [];
    expect(
      await proof.settle(
        'replacement',
        [
          policy(({ proposals }) => {
            saved = proposals;
            return [{ ...proposals[0]! }];
          }),
        ],
        undefined,
      ),
    ).toBeNull();
    expect(await proof.settle('replacement', [policy(() => saved)], undefined)).toBeNull();
    expect(
      await proof.settle(
        'replacement',
        [policy(({ proposals }) => [proposals[0]!, proposals[0]!])],
        undefined,
      ),
    ).toBeNull();

    const other = observeEffectContent(authority, [1, 2, 3, 4, 1], 'original');
    expect(
      await other.settle('original', [policy(({ proposals }) => proposals)], undefined),
    ).toBeNull();

    const absent = observeEffectContent(authority, undefined, 'original');
    expect(
      await absent.settle('original', [policy(({ proposals }) => proposals)], undefined),
    ).toBeNull();
  });
});
