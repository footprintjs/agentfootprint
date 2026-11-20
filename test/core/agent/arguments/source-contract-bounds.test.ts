/** Defensive composer bounds are separate from the public 32-ask declaration fence. */
import { describe, expect, it } from 'vitest';
import { MAX_ASK_ARGUMENTS } from '../../../../src/tools/declare.js';
import { TOOL_BATCH_FRAME_PREFIX } from '../../../../src/lib/saidByPerson.js';
import {
  prepareSourceContractFeedback,
  sourceDeclarationSchema,
} from '../../../../src/core/agent/findings/sourceContractFeedback.js';
import { contractIn, type Bag } from './sourceContractFixture.js';

const call = { id: 'bounded-call' };
const prepare = (names: readonly string[]) =>
  prepareSourceContractFeedback(
    [call],
    names.map((argument) => ({ toolCallId: call.id, argument })),
    true,
  );
const bytes = (content: string) => Buffer.byteLength(content, 'utf8');

describe('bounded source-contract projection', () => {
  it('uses canonical required members by immutable reference and carries no offer', () => {
    const withLedger = sourceDeclarationSchema(true);
    const declaration = (withLedger.properties as Bag)._findings as Bag;
    expect(Object.isFrozen(withLedger)).toBe(true);
    expect(Object.isFrozen(withLedger.properties)).toBe(true);
    expect(Object.isFrozen(declaration)).toBe(true);
    expect(Object.isFrozen(declaration.required)).toBe(true);
    expect(declaration.required).toEqual(['basis', 'from']);
    expect(Object.keys(declaration.properties as Bag)).toEqual(['basis', 'from']);
    expect(JSON.stringify(withLedger)).not.toContain('previous');
    expect(withLedger.required).toEqual(['_findings']);
    expect(sourceDeclarationSchema(true)).toBe(withLedger);
    expect(((sourceDeclarationSchema(false).properties as Bag)._findings as Bag).required).toEqual([
      'from',
    ]);
  });

  it('defensively refuses a 33-name composer input without claiming it passed native declaration intake', () => {
    const names = Array.from({ length: MAX_ASK_ARGUMENTS }, (_, i) => `field_${i}`);
    expect(prepare(names)).toBeDefined();
    expect(prepare([...names, 'one-more'])).toBeUndefined();
  });

  it('admits exactly 8KiB UTF-8, preserves a whole Unicode name, and refuses one more byte', () => {
    const overhead = bytes(prepare(['a'])![0]!) - 1;
    const available = 8 * 1024 - overhead;
    const name = 'é'.repeat(Math.floor(available / 2)) + (available % 2 ? 'a' : '');
    const content = prepare([name])![0]!;
    expect(bytes(content)).toBe(8 * 1024);
    expect(contractIn(content)?.missingArguments).toEqual([name]);
    expect(prepare([name + 'a'])).toBeUndefined();
  });

  it('counts unchanged sibling frames in the exact 64KiB whole-batch bound', () => {
    const initial = prepareSourceContractFeedback(
      [call, { id: 'sibling' }],
      [{ toolCallId: call.id, argument: 'a' }],
      true,
    )!;
    const held = initial[1]!;
    expect(held).toBe(
      `${TOOL_BATCH_FRAME_PREFIX} — framework feedback: source-declaration-required. No calls in that batch ran. That call was held because another call in that batch lacked an argument-source declaration. Submit a new batch.]`,
    );
    const siblings = Math.floor((64 * 1024 - bytes(initial[0]!)) / bytes(held));
    const calls = [call, ...Array.from({ length: siblings }, (_, i) => ({ id: `held-${i}` }))];
    const gap = 64 * 1024 - bytes(initial[0]!) - siblings * bytes(held);
    const name = 'a'.repeat(gap + 1);
    const at = prepareSourceContractFeedback(
      calls,
      [{ toolCallId: call.id, argument: name }],
      true,
    )!;
    expect(at.reduce((total, content) => total + bytes(content), 0)).toBe(64 * 1024);
    expect(
      prepareSourceContractFeedback(calls, [{ toolCallId: call.id, argument: name + 'a' }], true),
    ).toBeUndefined();
    expect(
      prepareSourceContractFeedback(
        [...calls, { id: 'extra' }],
        [{ toolCallId: call.id, argument: name }],
        true,
      ),
    ).toBeUndefined();
  });

  it('keeps call/name identities separate, never serializes values, and leaks no previous invocation', () => {
    const calls = [{ id: 'a|b', args: { secret: 'private-value-canary' } }, { id: 'a' }];
    const omissions = [
      {
        toolCallId: 'a|b',
        argument: 'c',
        value: 'private-value-canary',
        quote: 'private-quote-canary',
      },
      { toolCallId: 'a', argument: 'b|c' },
    ];
    const content = prepareSourceContractFeedback(calls, omissions, true)!;
    expect(content.map((frame) => contractIn(frame)?.missingArguments)).toEqual([['c'], ['b|c']]);
    expect(Object.isFrozen(content)).toBe(true);
    expect(content.join('')).not.toContain('private-value-canary');
    expect(content.join('')).not.toContain('private-quote-canary');
    expect(content.join('')).not.toContain('a|b');
    expect(contractIn(prepare(['next'])![0]!)?.missingArguments).toEqual(['next']);
    expect(content.map((frame) => contractIn(frame)?.missingArguments)).toEqual([['c'], ['b|c']]);
  });

  it('names only the proposal whose declaration is missing when IDs repeat', () => {
    const first = { id: 'repeated', callOccurrenceKey: [1, 2, 3, 4, 0] as const };
    const second = { id: 'repeated', callOccurrenceKey: [1, 2, 3, 4, 1] as const };
    const messages = prepareSourceContractFeedback(
      [first, second],
      [{ toolCallId: second.id, callOccurrenceKey: second.callOccurrenceKey, argument: 'unit' }],
      true,
    );
    expect(messages?.[0]).toContain('another call');
    expect(contractIn(messages?.[1] ?? '')?.missingArguments).toEqual(['unit']);
    expect(messages?.join('')).not.toContain('callOccurrenceKey');
  });
});
