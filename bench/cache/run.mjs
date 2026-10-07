/**
 * bench/cache/run.mjs — the cacheable share of the inputs bench's recorded cases, at $0.
 *
 * Every case of `bench/inputs/cases.mjs` (`ALL_CASES`) is played by its scripted variants — the
 * same fixtures `bench/inputs` replays — through the package's REAL Anthropic adapter. The SDK
 * client under the adapter is a stub: it keeps each wire body (the `params` the adapter built,
 * cache markers included) and answers with the scripted model's reply. Nothing leaves the
 * machine. `share.mjs` then replays each run's bodies through Anthropic's prefix-cache model.
 *
 * Three provider shapes, because the provider is what used to pick the cache strategy:
 *   - `anthropic()`          the adapter as shipped;
 *   - `withRetry(...)`       the library's own decorator around it;
 *   - `app wrapper`          an application's own decorator (renames the provider, forwards the
 *                            capabilities the adapter declares — the shape a host app writes).
 *
 *   npm run build && node bench/cache/run.mjs [--arms off,full] [--json <file>]
 *
 * Columns: `marked` = bytes up to a request's last breakpoint (what it offers to cache);
 * `read` = bytes an earlier request of the same conversation wrote and this one repeats exactly
 * (what the cache could serve). `marked share` and `read share` are of all request bytes, first
 * calls included (a first call has nothing to read); `read share, calls 2+` is of the bytes of
 * every call after a conversation's first — how much of a request the cache serves once the
 * conversation is going. Markers that are written and never read are a surcharge: a cache write
 * costs 1.25× input on Anthropic, a read 0.1×.
 */
import { writeFileSync } from 'node:fs';

import { ALL_CASES } from '../inputs/cases.mjs';
import { runCase } from '../inputs/harness.mjs';
import { foldShares, replayConversation } from './share.mjs';

const flags = new Map();
for (let i = 2; i < process.argv.length; i += 2) flags.set(process.argv[i], process.argv[i + 1]);
const ARMS_RUN = (flags.get('--arms') ?? 'off,full').split(',');

const [{ Agent, defineTool }, { mock, anthropic }, { recordRun, assessAnswer }, { withRetry }] =
  await Promise.all([
    import('agentfootprint'),
    import('agentfootprint/providers'),
    import('agentfootprint/observe'),
    import('agentfootprint/resilience'),
  ]);

/** The scripted reply (port shape) → the Anthropic message the SDK would have returned. */
function toWireMessage(reply, model) {
  const content = [
    ...(reply.content ? [{ type: 'text', text: reply.content }] : []),
    ...(reply.toolCalls ?? []).map((c) => ({
      type: 'tool_use',
      id: c.id,
      name: c.name,
      input: c.args,
    })),
  ];
  return {
    id: 'msg_stub',
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: (reply.toolCalls ?? []).length > 0 ? 'tool_use' : 'end_turn',
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

/**
 * The real Anthropic adapter over a stub client that keeps every body and answers with the
 * scripted model. The adapter sees only the wire; the scripted model sees the port request the
 * agent sent, exactly as `bench/inputs` plays it.
 */
function measuredAnthropic(scripted, bodies) {
  let pending;
  const answer = async (params) => {
    bodies.push(JSON.parse(JSON.stringify(params)));
    return toWireMessage(await scripted.complete(pending), params.model);
  };
  const client = {
    messages: {
      create: (params) => answer(params),
      stream: (params) => {
        const message = answer(params);
        return {
          async *[Symbol.asyncIterator]() {
            for (const b of (await message).content)
              if (b.type === 'text')
                yield { type: 'content_block_delta', delta: { type: 'text_delta', text: b.text } };
          },
          finalMessage: () => message,
        };
      },
    },
  };
  const adapter = anthropic({ _client: client });
  return {
    ...adapter,
    complete: (req, hooks) => {
      pending = req;
      return adapter.complete(req, hooks);
    },
    stream: (req, hooks) => {
      pending = req;
      return adapter.stream(req, hooks);
    },
  };
}

/** An application's decorator: its own name, every declared capability forwarded by hand. */
function appWrapper(inner) {
  return {
    name: `app/${inner.name}`,
    ...(inner.carriesInMessages !== undefined && { carriesInMessages: inner.carriesInMessages }),
    ...(inner.carriesForcedToolChoice !== undefined && {
      carriesForcedToolChoice: inner.carriesForcedToolChoice,
    }),
    ...(inner.promptCaching !== undefined && { promptCaching: inner.promptCaching }),
    complete: (req, hooks) => inner.complete(req, hooks),
    stream: (req, hooks) => inner.stream(req, hooks),
  };
}

const SHAPES = [
  ['anthropic()', (p) => p],
  ['withRetry(anthropic())', (p) => withRetry(p)],
  ['app wrapper', (p) => appWrapper(p)],
];

const rows = [];
for (const [shape, wrap] of SHAPES) {
  for (const arm of ARMS_RUN) {
    const runs = [];
    for (const caseDef of ALL_CASES) {
      for (let rep = 0; rep < caseDef.mock.length; rep += 1) {
        const bodies = [];
        const doors = {
          Agent,
          defineTool,
          recordRun,
          assessAnswer,
          anthropic,
          // runCase builds its scripted model through `doors.mock`; the model answers, the real
          // adapter (wrapped as `shape` says) builds the wire.
          mock: (opts) => wrap(measuredAnthropic(mock(opts), bodies)),
        };
        await runCase({ doors, caseDef, arm, rep, provider: 'mock', model: 'mock' });
        runs.push(replayConversation(bodies));
      }
    }
    rows.push({ shape, arm, ...foldShares(runs) });
  }
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
console.log(
  '| provider | arm | runs | calls | calls that read | marked share | read share | read share, calls 2+ |',
);
console.log('|---|---|---:|---:|---:|---:|---:|---:|');
for (const r of rows) {
  console.log(
    `| ${r.shape} | ${r.arm} | ${r.runs} | ${r.calls} | ${r.callsThatRead}/${r.callsAfterFirst} | ` +
      `${pct(r.markedShare)} | ${pct(r.readShare)} | ${pct(r.repeatReadShare)} |`,
  );
}
if (flags.has('--json')) writeFileSync(flags.get('--json'), `${JSON.stringify(rows, null, 2)}\n`);
