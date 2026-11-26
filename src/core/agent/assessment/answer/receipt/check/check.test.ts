import { describe, expect, it, vi } from 'vitest';
import { assessExecutionClaims } from './check.js';

function check(reply: string) {
  return assessExecutionClaims({
    reply,
    defaultTarget: 'current',
    evidence: { current: 'confirmed', previous: 'none' },
  });
}

function outcome(claim: 'ran-code' | 'no-code', value: 'verified' | 'contradicted' | 'unverified') {
  return { complete: true, findings: [{ claim, target: 'current', outcome: value }] };
}

describe('execution claims', () => {
  it.each([
    ['confirmed', 'verified', 'contradicted'],
    ['none', 'contradicted', 'verified'],
    ['unknown', 'unverified', 'unverified'],
    [undefined, 'unverified', 'unverified'],
  ] as const)(
    'compares execution and estimate-only claims to %s evidence',
    (evidence, ran, none) => {
      const facts = {
        defaultTarget: 'current',
        evidence: evidence ? { current: evidence } : {},
      } as const;
      expect(assessExecutionClaims({ ...facts, reply: 'I ran code.' })).toEqual(
        outcome('ran-code', ran),
      );
      expect(
        assessExecutionClaims({ ...facts, reply: 'I only estimated, without running code.' }),
      ).toEqual(outcome('no-code', none));
    },
  );

  it('pegs an earlier answer to the owned previous turn only', () => {
    expect(check('I ran code for the previous answer.')).toEqual({
      complete: true,
      findings: [{ claim: 'ran-code', target: 'previous', outcome: 'contradicted' }],
    });
    expect(
      assessExecutionClaims({
        reply: 'I ran code for that answer.',
        defaultTarget: 'previous',
        evidence: { current: 'none', previous: 'confirmed' },
      }),
    ).toEqual({
      complete: true,
      findings: [{ claim: 'ran-code', target: 'previous', outcome: 'verified' }],
    });
    expect(
      assessExecutionClaims({
        reply: 'I ran code for that answer.',
        evidence: { current: 'confirmed' },
      }),
    ).toEqual(outcome('ran-code', 'unverified'));
  });

  it('recognizes execution to estimate without treating estimation alone as exclusive', () => {
    expect(check('I ran code to estimate.')).toEqual(outcome('ran-code', 'verified'));
    expect(check('I estimated.')).toBeUndefined();
    expect(check('I only estimated.')).toBeUndefined();
  });

  it('does not tie an output to code based on an independent same-turn execution', () => {
    expect(check('This number came from code.')).toEqual(outcome('ran-code', 'unverified'));
    expect(check('I ran code to calculate that figure.')).toEqual(
      outcome('ran-code', 'unverified'),
    );
    expect(check('I estimated this total without running code.')).toEqual(
      outcome('no-code', 'unverified'),
    );
  });

  it.each([
    'I ran code?',
    'If I ran code, this would be exact.',
    'I plan to run code.',
    'They said I ran code.',
    'I might have run code.',
    'I ran code for an unrelated request.',
    '“Example: I ran code.”',
    'The tool reported: I ran code.',
    'The previous model wrote:\n\nI ran code.',
    'The previous model wrote:\n\n\n\nI ran code.',
    'The previous model wrote:\n\nA preface.\n\nI ran code.',
    '“The prior model answered.\n\nI ran code.\n\n”',
    "“Earlier message with a 'label' inside.\n\nI ran code.\n\n”",
    '<blockquote>Example.\n\nI ran code.\n\n</blockquote>',
    '<!-- Draft evidence.\n\nI ran code.\n\n-->',
    '‘Earlier response. I ran code. That is a quote.’',
    "'Earlier response. I ran code. That is a quote.'",
    '> An answer from a different run.\nI ran code.',
    '- > An answer from a different run.\n  I ran code.',
    '\x60I ran code.\x60',
    '\x60\x60\x60text\nExample.\n\nI ran code.\n\x60\x60\x60',
    '    I ran code.',
    '[I ran code.](https://example.test)',
    '<blockquote>Example.\nI ran code.</blockquote>',
    'Before I explain; I ran code.',
  ])('skips wording without a clear assistant assertion in %j', (reply) => {
    expect(check(reply)).toBeUndefined();
  });

  it('checks separate plain prose after an excluded block', () => {
    expect(check('> A quotation.\n\nI did not run code.')).toEqual(
      outcome('no-code', 'contradicted'),
    );
    expect(check('“Another answer.”\n\nI ran code.')).toEqual(outcome('ran-code', 'verified'));
    expect(check('My answer follows. I didn’t run code.')).toEqual(
      outcome('no-code', 'contradicted'),
    );
  });

  it('does not invoke an accessor offered as execution evidence', () => {
    const get = vi.fn(() => 'confirmed');
    const evidence = Object.defineProperty({}, 'current', { get });
    expect(
      assessExecutionClaims({ reply: 'I ran code.', defaultTarget: 'current', evidence }),
    ).toEqual(outcome('ran-code', 'unverified'));
    expect(get).not.toHaveBeenCalled();
  });

  it('keeps a limit separate from an absent claim', () => {
    expect(check('I ran code. ' + 'x'.repeat(65_536))).toEqual({ complete: false, findings: [] });
    expect(check('I ran code. '.repeat(17))).toEqual({ complete: false, findings: [] });
  });
});
