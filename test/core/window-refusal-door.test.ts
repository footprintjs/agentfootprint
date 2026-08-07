/**
 * "Already set" names the door that set it — in every direction (8.18.0).
 *
 * `.window()`, `.compaction()` and `.act({ window })` are three doors into ONE
 * setting, and a second call is refused because a window policy that quietly
 * changed is a policy nobody can audit. That part has been right for releases.
 *
 * What was wrong was how much you were told, which depended on which direction
 * you approached from: `.window()` named the strategy and then talked about
 * `.compaction()` — even when `.act({ window })` was what had set it — while
 * `.act()` said "set by .window() or .compaction()", an `or` that was sometimes
 * neither. A caller hitting this is holding two lines of code and needs to know
 * which one already won.
 *
 * Six directions, one sentence shape, and the door recorded at the moment it
 * becomes true.
 */

import { describe, expect, it } from 'vitest';

import { Agent, slidingWindow, tokenBudget } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';

const base = (): ReturnType<typeof Agent.create> =>
  Agent.create({ provider: mock({ reply: 'x' }), model: 'm' });

const compaction = (): {
  thresholdTokens: number;
  summarizer: ReturnType<typeof mock>;
  model: string;
} => ({ thresholdTokens: 100, summarizer: mock({ reply: 's' }), model: 'summarizer-model' });

/** Every ordered pair of doors, and the door each pair should NAME. */
const pairs: ReadonlyArray<{
  readonly label: string;
  readonly build: () => unknown;
  readonly names: RegExp;
}> = [
  {
    label: '.window() then .window()',
    build: () =>
      base()
        .window(slidingWindow({ keepRecentTurns: 4 }))
        .window(tokenBudget({ thresholdTokens: 10 })),
    names: /set by \.window\(\)/,
  },
  {
    label: '.window() then .compaction()',
    build: () =>
      base()
        .window(slidingWindow({ keepRecentTurns: 4 }))
        .compaction(compaction()),
    names: /set by \.window\(\)/,
  },
  {
    label: '.window() then .act({ window })',
    build: () =>
      base()
        .window(slidingWindow({ keepRecentTurns: 4 }))
        .act({ window: slidingWindow({ keepRecentTurns: 8 }) }),
    names: /set by \.window\(\)/,
  },
  {
    label: '.compaction() then .window()',
    build: () =>
      base()
        .compaction(compaction())
        .window(slidingWindow({ keepRecentTurns: 4 })),
    names: /set by \.compaction\(\)/,
  },
  {
    label: '.compaction() then .compaction()',
    build: () => base().compaction(compaction()).compaction(compaction()),
    names: /set by \.compaction\(\)/,
  },
  {
    label: '.act({ window }) then .window()',
    build: () =>
      base()
        .act({ window: slidingWindow({ keepRecentTurns: 8 }) })
        .window(slidingWindow({ keepRecentTurns: 4 })),
    names: /set by \.act\(\{ window \}\)/,
  },
  {
    label: '.act({ window }) then .compaction()',
    build: () =>
      base()
        .act({ window: slidingWindow({ keepRecentTurns: 8 }) })
        .compaction(compaction()),
    names: /set by \.act\(\{ window \}\)/,
  },
];

describe('window refusals — the door is named in every direction', () => {
  for (const { label, build, names } of pairs) {
    it(`${label} names the door that set it`, () => {
      expect(build).toThrow(names);
    });

    it(`${label} still states the law and the strategy`, () => {
      expect(build).toThrow(
        /already has a window strategy \('(sliding-window|summarize-oldest)'\)/,
      );
      expect(build).toThrow(/One window strategy per agent/);
    });
  }

  it('a single call through any door is accepted', () => {
    expect(() =>
      base()
        .window(slidingWindow({ keepRecentTurns: 4 }))
        .build(),
    ).not.toThrow();
    expect(() => base().compaction(compaction()).build()).not.toThrow();
    expect(() =>
      base()
        .act({ window: slidingWindow({ keepRecentTurns: 8 }) })
        .build(),
    ).not.toThrow();
  });

  it('the refusal points at the other doors without claiming one of them set it', () => {
    // The old `.window()` sentence asserted `.compaction()` was "the same
    // door"; true, but read as an attribution when `.act({ window })` was the
    // caller's actual line. Attribution and vocabulary are now separate
    // sentences.
    const err = (() => {
      try {
        base()
          .act({ window: slidingWindow({ keepRecentTurns: 8 }) })
          .window(slidingWindow({ keepRecentTurns: 4 }));
      } catch (e) {
        return e as Error;
      }
      throw new Error('expected a refusal');
    })();
    expect(err.message).toMatch(/set by \.act\(\{ window \}\)/);
    expect(err.message).toMatch(/`\.compaction\(\)` is this same door/);
  });
});
