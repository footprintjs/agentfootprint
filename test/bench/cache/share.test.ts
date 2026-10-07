/**
 * bench/cache/share.mjs — the ruler the cache bench's numbers come from.
 *
 * Test types: unit (a hand-counted pair of bodies) / boundary (no breakpoint,
 * a changed byte, the 20-block lookback) / property (a cache_control never
 * changes a key; a string is the text block it stands for).
 */
import { describe, expect, it } from 'vitest';

import { foldShares, replayConversation, wireBlocks } from '../../../bench/cache/share.mjs';

const tool = { name: 'lookup', description: 'd', input_schema: { type: 'object' } };
const mark = { type: 'ephemeral' };

/** Bytes of one serialized block, exactly as the ruler counts them. */
const b = (v: unknown) => Buffer.byteLength(JSON.stringify(v));

describe('cache share ruler — unit', () => {
  it('the second call reads exactly the bytes up to the first call’s breakpoint', () => {
    const first = {
      tools: [tool],
      system: [{ type: 'text', text: 'sys', cache_control: mark }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q', cache_control: mark }] }],
    };
    const second = {
      tools: [tool],
      system: [{ type: 'text', text: 'sys', cache_control: mark }],
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
        { role: 'user', content: [{ type: 'text', text: 'q2', cache_control: mark }] },
      ],
    };
    const r = replayConversation([first, second]);
    const settings = b({ tool_choice: null, thinking: null });
    const upToQ =
      b(tool) + b({ type: 'text', text: 'sys' }) + settings + b({ type: 'text', text: 'q' });
    expect(r.perCall[0]!.read).toBe(0);
    expect(r.perCall[1]!.read).toBe(upToQ);
    expect(r.perCall[1]!.total).toBe(
      upToQ + b({ type: 'text', text: 'a' }) + b({ type: 'text', text: 'q2' }),
    );
  });
});

describe('cache share ruler — boundary', () => {
  it('no breakpoint: nothing written, nothing read', () => {
    const body = { tools: [tool], system: 'sys', messages: [{ role: 'user', content: 'q' }] };
    const r = replayConversation([body, body]);
    expect(r.read).toBe(0);
    expect(r.marked).toBe(0);
  });

  it('one changed byte before the breakpoint: no read', () => {
    const a = { system: [{ type: 'text', text: 'sys', cache_control: mark }], messages: [] };
    const c = { system: [{ type: 'text', text: 'sys!', cache_control: mark }], messages: [] };
    expect(replayConversation([a, c]).perCall[1]!.read).toBe(0);
  });

  it('the lookback: an entry more than 20 blocks behind every breakpoint is not found', () => {
    const head = { role: 'user', content: [{ type: 'text', text: 'q', cache_control: mark }] };
    const filler = Array.from({ length: 25 }, (_, i) => ({ role: 'user', content: `f${i}` }));
    const tail = { role: 'user', content: [{ type: 'text', text: 'end', cache_control: mark }] };
    const first = { messages: [head] };
    const far = { messages: [{ role: 'user', content: 'q' }, ...filler, tail] };
    const near = { messages: [{ role: 'user', content: 'q' }, ...filler.slice(0, 5), tail] };
    expect(replayConversation([first, far]).perCall[1]!.read).toBe(0);
    expect(replayConversation([first, near]).perCall[1]!.read).toBeGreaterThan(0);
  });
});

describe('cache share ruler — property', () => {
  it('a cache_control never changes a key, and a string is the text block it stands for', () => {
    const marked = wireBlocks({
      system: [{ type: 'text', text: 's', cache_control: mark }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q', cache_control: mark }] }],
    });
    const plain = wireBlocks({ system: 's', messages: [{ role: 'user', content: 'q' }] });
    expect(marked.map((x) => x.key)).toEqual(plain.map((x) => x.key));
    expect(marked.filter((x) => x.breakpoint)).toHaveLength(2);
    expect(plain.filter((x) => x.breakpoint)).toHaveLength(0);
  });

  it('foldShares: the repeat-call share excludes first calls, which have nothing to read', () => {
    const body = { system: [{ type: 'text', text: 'sys', cache_control: mark }], messages: [] };
    const run = replayConversation([body, body]);
    const row = foldShares([run]);
    const sys = b({ type: 'text', text: 'sys' });
    const settings = b({ tool_choice: null, thinking: null });
    // The settings block sits after the system breakpoint, so it is sent but never read.
    expect(row.readShare).toBeCloseTo(sys / (2 * (sys + settings)));
    expect(row.repeatReadShare).toBeCloseTo(sys / (sys + settings));
  });
});
