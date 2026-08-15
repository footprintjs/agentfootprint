/**
 * `agentfootprint.tools.code_run` — the event that turns generated code into a
 * tool backlog.
 *
 * Every program a model writes is a request for a tool nobody built. The code
 * has always been in the recordings as an ordinary tool argument, so the loop
 * worked — but only for somebody who already knew to go looking for it. This
 * event makes it discoverable, and the shape hash is what makes it countable:
 * rank the shapes by how often they recur and the top of the list is a build
 * queue in build order.
 *
 * The load-bearing test here is the last one. The code itself must never travel
 * on this channel, because generated code quotes the data it was handed — a
 * row, a serial, an address — and this payload goes to every attached exporter.
 * That is the same rule the tool-session events already follow by publishing
 * `keyHash` and never the key.
 */
import { describe, expect, it } from 'vitest';

import { codeShape } from '../../../src/core/codeRunnerTool.js';

describe('codeShape — two runs of one computation reduce to one shape', () => {
  it('erases the data and keeps the operations', () => {
    const overWwns = `
      const rows = JSON.parse(input);
      const byPort = groupBy(rows, 'wwn');
      const busy = Object.entries(byPort).filter(([, v]) => v.length > 250);
      console.log(JSON.stringify(busy));
    `;
    const overSerials = `
      const items = JSON.parse(input);
      const byThing = groupBy(items, 'serial');
      const hot = Object.entries(byThing).filter(([, v]) => v.length > 1000);
      console.log(JSON.stringify(hot));
    `;
    expect(codeShape(overWwns)).toBe(codeShape(overSerials));
  });

  it('keeps genuinely different computations apart', () => {
    const grouped = `const g = groupBy(rows, 'a'); console.log(g);`;
    const sorted = `const s = sortBy(rows, 'a'); console.log(s.slice(0, 10));`;
    expect(codeShape(grouped)).not.toBe(codeShape(sorted));
  });

  it('ignores comments, so a re-run the model annotated differently still groups', () => {
    const bare = `const t = total(rows); console.log(t);`;
    const chatty = `
      // First we total the rows, because the user asked for a sum.
      const t = total(rows); // running total
      console.log(t);
    `;
    expect(codeShape(chatty)).toBe(codeShape(bare));
  });

  it('erases the VALUES a program embeds, which is why the hash is safe to emit', () => {
    // The reason this function exists at all: a model that pasted data into a
    // script must not have pasted it onto the event channel too.
    const withSecrets = `
      const rows = [{ wwn: '50:06:01:60:BB:20:1A:2F', owner: 'alice@example.com' }];
      console.log(rows.filter((r) => r.owner === 'alice@example.com').length);
    `;
    const shape = codeShape(withSecrets);
    for (const leak of ['50:06:01:60', 'alice@example.com', 'alice']) {
      expect(shape, `the shape still contains ${leak}`).not.toContain(leak);
    }
  });
});
