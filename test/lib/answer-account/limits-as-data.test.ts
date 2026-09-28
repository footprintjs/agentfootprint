/**
 * The answer account reads what the framework carried WITH the answer — the
 * appended section of a prose answer, and a typed answer's limits as data.
 *
 * THE GAP CLOSED (the review of #27, follow-up 1): `readAnswer` found the
 * limits only by the prose block's heading in `turn_end.finalContent`, so a
 * TYPED run — whose limits travel beside the answer as data — read
 * `limitsBlock: not-applicable`, which a reader could take to mean the answer
 * had no limits. It now reads `turn_end.answerCoverage` into `limitsData`
 * (recorded, a pointer to every item) and says why there is no block
 * (`missing: 'as-data'`) — never `not-applicable` when the limits travelled.
 *
 * And the split is the framework's whole appended section, found at the
 * separator: the two blocks by their headings (the limits block, the "Assumed"
 * block), and the answer layer's standing line by its EXACT words, rebuilt
 * from the run's record — an "Assumed" block alone, or a standing line alone,
 * no longer reads as the model's own words, and the model's own words never
 * read as the library's: a `---` the model wrote itself is never split, nor a
 * model answer that uses the line's plain openings ("Not sure — ").
 *
 * Test types: INTEGRATION (real runs on the mock, recorded) · EDGE (the
 * model's own separator and standing words, on a plain agent and on one with
 * the layer but not the line; an answer with no text of its own; a record
 * without its committed state) · REGRESSION (a prose run with no appended
 * section and no data reads as it always did) — every account's pointers
 * resolve (P1) and print no refused leaf (P7).
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { Agent, coverage, defineTool } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { accountForAnswer, recordRun } from '../../../src/observe.js';
import { showLeaves } from '../../../src/lib/answer-account/shown.js';
import type { Recording } from '../../../src/recorders/observability/recordRun.js';
import { assertP1, assertP7 } from './helpers.js';

const Verdict = z.object({ healthy: z.boolean() }).strict();

const health = defineTool({
  name: 'replication_health',
  description: 'Replication health across the estate',
  inputSchema: { type: 'object', properties: {} },
  execute: () =>
    coverage(
      { verdict: 'all pairs synchronized' },
      {
        checked: ['SRDF pair state'],
        notChecked: [{ what: 'NDM sessions', why: 'the API timed out' }],
        cannotCover: [{ what: 'host-side multipathing', why: 'no collector there' }],
      },
    ),
});

const searchLogs = defineTool({
  name: 'search_logs',
  description: 'Error lines for one service over a look-back period.',
  inputSchema: {
    type: 'object',
    required: ['service', 'window'],
    properties: {
      service: { type: 'string' },
      window: { type: 'string', enum: ['1h', '2h', '24h'] },
    },
  },
  askOrAssume: { window: { assume: '2h' } },
  execute: async () => ({ errors: 0 }),
});

async function recorded(agent: Agent, message: string): Promise<Recording> {
  const recorder = recordRun(agent);
  await agent.run({ message });
  const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
  recorder.stop();
  return recording;
}

const callThen = (name: string, args: Record<string, unknown>, answer: string) =>
  mock({ replies: [{ toolCalls: [{ id: 'c1', name, args }] }, { content: answer }] as never });

describe('INTEGRATION — a typed answer’s limits, as data', () => {
  it('limitsData is recorded, with a pointer to every item; the block says it travelled as data', async () => {
    const agent = Agent.create({
      provider: callThen('replication_health', {}, '{"healthy":true}'),
      model: 'mock',
    })
      .tool(health)
      .outputSchema(Verdict)
      .limitsTravelWithTheAnswer()
      .build();
    const recording = await recorded(agent, 'is replication healthy?');
    const account = accountForAnswer(recording);
    expect(account.answer.value).toBe('{"healthy":true}');
    expect(account.facts.limitsData).toMatchObject({
      value: { checked: 1, notChecked: 1, cannotCover: 1, assumed: 0 },
      source: 'library',
      status: 'recorded',
    });
    expect(account.facts.limitsData.pointers).toHaveLength(3);
    expect(account.facts.limitsBlock).toEqual({
      value: null,
      source: 'library',
      status: 'not-recorded',
      pointers: [],
      missing: 'as-data',
    });
    assertP1(account, recording);
    assertP7(account, recording);
  });

  it('the values a tool’s rule assumed are counted beside the limits', async () => {
    const agent = Agent.create({
      provider: callThen('search_logs', { service: 'checkout' }, '{"healthy":true}'),
      model: 'mock',
    })
      .tool(searchLogs)
      .outputSchema(Verdict)
      .limitsTravelWithTheAnswer()
      .build();
    const recording = await recorded(agent, 'errors on checkout?');
    const account = accountForAnswer(recording);
    expect(account.facts.limitsData.value).toEqual({
      checked: 0,
      notChecked: 0,
      cannotCover: 0,
      assumed: 1,
    });
    assertP1(account, recording);
    // P7 matches a denied leaf as a SUBSTRING of the whole response, and the ledger's `argument`
    // row carries the bare string 'argument' as its kind — which the standing's witness path
    // '/0/argument' then "contains". A key name, not a leak (the fold-integration precedent); the
    // invariant P7 guards is asserted directly: the assumed VALUE never leaves in the response.
    const response = JSON.stringify({ account, shown: showLeaves(account, recording) });
    expect(response).not.toContain('"2h"');
    expect(response).not.toContain('\\"2h\\"');
  });
});

describe('INTEGRATION — a prose answer’s appended section, split at the separator', () => {
  it('the standing line alone: the answer is the model’s words, the section is the library’s', async () => {
    const agent = Agent.create({
      provider: callThen('list_ports', {}, 'Replication is healthy.'),
      model: 'mock',
    })
      .tool(
        defineTool({
          name: 'list_ports',
          description: 'ports',
          inputSchema: { type: 'object', properties: {} },
          execute: () => [],
        }),
      )
      .answerLayer({ standingLine: true })
      .build();
    const recording = await recorded(agent, 'is replication healthy?');
    const account = accountForAnswer(recording);
    expect(account.answer.value).toBe('Replication is healthy.');
    expect(account.facts.limitsBlock.value).toBe(
      'Not sure — a lookup came back empty without saying what it searched.',
    );
    expect(account.facts.limitsData.status).toBe('not-applicable');
    assertP1(account, recording);
    assertP7(account, recording);
  });

  it('an "Assumed" block alone no longer reads as the model’s words', async () => {
    const agent = Agent.create({
      provider: callThen('search_logs', { service: 'checkout' }, 'No errors.'),
      model: 'mock',
    })
      .tool(searchLogs)
      .limitsTravelWithTheAnswer()
      .build();
    const recording = await recorded(agent, 'errors on checkout?');
    const account = accountForAnswer(recording);
    expect(account.answer.value).toBe('No errors.');
    expect(account.facts.limitsBlock.value).toBe(
      'Assumed (a tool\'s rule, not your words):\n- window = "2h" (search_logs)',
    );
  });

  it('the line, the limits and the block: one section, in the composer’s order', async () => {
    const agent = Agent.create({
      provider: callThen('replication_health', {}, 'Replication is healthy.'),
      model: 'mock',
    })
      .tool(health)
      .limitsTravelWithTheAnswer()
      .answerLayer({ standingLine: true })
      .build();
    const recording = await recorded(agent, 'is replication healthy?');
    const account = accountForAnswer(recording);
    expect(account.answer.value).toBe('Replication is healthy.');
    const section = account.facts.limitsBlock.value!;
    expect(section.startsWith('Not sure — ')).toBe(true);
    expect(section).toContain('Coverage of this answer');
  });
});

describe('EDGE — what is never split', () => {
  it('a `---` the model wrote itself stays in the answer', async () => {
    const agent = Agent.create({
      provider: mock({ reply: 'Part one.\n\n---\n\nPart two.' }),
      model: 'mock',
    }).build();
    const recording = await recorded(agent, 'two parts?');
    const account = accountForAnswer(recording);
    expect(account.answer.value).toBe('Part one.\n\n---\n\nPart two.');
    expect(account.facts.limitsBlock.status).toBe('not-applicable');
    expect(account.facts.limitsData.status).toBe('not-applicable');
  });

  // The standing line's words are the owner's plain words ("Not sure — ",
  // "Known — ") — words a model can write too. They are the library's only
  // where the record says the run appended THIS line: the answer layer's
  // standing on `turn_end`, and the exact line rebuilt from it.
  it.each([
    [
      'an answer that opens with a standing word',
      'Not sure — the host is not in the inventory I can see.',
    ],
    [
      'its own `---`, then a standing word',
      'Port 3 is down.\n\n---\n\nKnown — port 3 has been down since Monday.',
    ],
  ])('a plain agent’s model words stay the model’s: %s', async (_, reply) => {
    const agent = Agent.create({ provider: mock({ reply }), model: 'mock' }).build();
    const recording = await recorded(agent, 'where is it?');
    const account = accountForAnswer(recording);
    expect(account.answer.value).toBe(reply);
    expect(account.answer.source).toBe('model');
    expect(account.facts.limitsBlock.status).toBe('not-applicable');
  });

  it('the answer layer armed WITHOUT the line: a model `---` then "Not sure — …" stays the model’s', async () => {
    const reply = 'Port 3 is down.\n\n---\n\nNot sure — I only saw one switch.';
    const agent = Agent.create({ provider: callThen('list_ports', {}, reply), model: 'mock' })
      .tool(
        defineTool({
          name: 'list_ports',
          description: 'ports',
          inputSchema: { type: 'object', properties: {} },
          execute: () => [],
        }),
      )
      .answerLayer()
      .build();
    const recording = await recorded(agent, 'which ports are down?');
    const account = accountForAnswer(recording);
    // The run's standing IS "not sure" — and still the model wrote these words, not the library.
    expect(account.facts.standing.value).toBe('not-sure');
    expect(account.answer.value).toBe(reply);
    expect(account.facts.limitsBlock.status).toBe('not-applicable');
  });
});

describe('INTEGRATION — the standing line is found by its exact words, rebuilt from the record', () => {
  it('the line alone on an answer with no words of its own: all of it is the library’s', async () => {
    // No tool at all; the model asks for one at the limit and says nothing, so
    // the composer appends the line with no separator (the answer is empty).
    const agent = Agent.create({
      provider: mock({
        replies: [{ content: '', toolCalls: [{ id: 'g1', name: 'ghost', args: {} }] }] as never,
      }),
      model: 'mock',
      maxIterations: 1,
    })
      .answerLayer({ standingLine: true })
      .build();
    const recording = await recorded(agent, 'hello?');
    const account = accountForAnswer(recording);
    expect(account.answer.value).toBe('');
    expect(account.facts.limitsBlock).toMatchObject({
      value: 'Not sure — the run stopped before the model finished.',
      source: 'library',
      status: 'recorded',
    });
    assertP1(account, recording);
  });

  it('a line naming an assumed value — rebuilt from the committed rows it was composed from', async () => {
    const agent = Agent.create({
      provider: callThen('search_logs', { service: 'checkout' }, 'No errors.'),
      model: 'mock',
    })
      .tool(searchLogs)
      .answerLayer({ standingLine: true })
      .build();
    const recording = await recorded(agent, 'errors on checkout?');
    const account = accountForAnswer(recording);
    expect(account.answer.value).toBe('No errors.');
    expect(account.facts.limitsBlock.value).toBe(
      'Not sure — window = "2h" was assumed by search_logs\'s rule, not given by you.',
    );
  });

  it('a record without the committed state cannot rebuild that line — it is never claimed for the library', async () => {
    const agent = Agent.create({
      provider: callThen('search_logs', { service: 'checkout' }, 'No errors.'),
      model: 'mock',
    })
      .tool(searchLogs)
      .answerLayer({ standingLine: true })
      .build();
    const recording = await recorded(agent, 'errors on checkout?');
    const { snapshot: _dropped, ...withoutState } = recording as unknown as Record<string, unknown>;
    void _dropped;
    const account = accountForAnswer(withoutState as unknown as Recording);
    expect(account.answer.value).toBe(
      'No errors.\n\n---\n\nNot sure — window = "2h" was assumed by search_logs\'s rule, not given by you.',
    );
    expect(account.facts.limitsBlock.status).toBe('not-applicable');
  });
});
