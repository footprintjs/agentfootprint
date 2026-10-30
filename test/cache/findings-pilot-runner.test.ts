import { describe, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import ts from 'typescript';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Agent, defineTool } from '../../src/index.js';
import { anthropic, mock } from '../../src/doors/providers.js';
import { runArm, canaries, modules } from '../../bench/cache/pilot/arms.mjs';
import { pilotBudget, RESERVATION_MICRO_USD, MODEL } from '../../bench/cache/pilot/budget.mjs';
import {
  observation,
  scenarios,
  scriptedReply,
  systemText,
} from '../../bench/cache/pilot/fixture.mjs';
import { lookupTable } from '../../bench/cache/verify-fixture.mjs';
import {
  answerCheck,
  ANSWER_FORMS,
  ANSWER_VALUES,
  READ_COUNTS,
} from '../../bench/cache/pilot/answerCheck.mjs';
import { openJournal } from '../../bench/cache/pilot/journal.mjs';
import {
  closureHash,
  KIT_FILES,
  kitHashes,
  payloadHash,
  verifyKit,
} from '../../bench/cache/pilot/identity.mjs';
import { liveTransport } from '../../bench/cache/pilot/live.mjs';
import { pilot } from '../../bench/cache/pilot/run.mjs';
const api = { Agent, defineTool, anthropic, mock };
describe('findings pilot free end-to-end setup', () => {
  it('loads the pinned package entries instead of an unhashed consumer self-reference', () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-pilot-self-reference-'));
    try {
      const pinned = join(dir, 'node_modules/af-baseline');
      mkdirSync(pinned, { recursive: true });
      writeFileSync(
        join(pinned, 'package.json'),
        JSON.stringify({
          name: 'agentfootprint',
          exports: {
            '.': { require: { default: './index.cjs' } },
            './providers': { require: { default: './providers.cjs' } },
          },
        }),
      );
      writeFileSync(join(pinned, 'index.cjs'), 'exports.Agent="verified";');
      writeFileSync(join(pinned, 'providers.cjs'), 'exports.mock="verified";');
      writeFileSync(
        join(dir, 'override.cjs'),
        'exports.Agent="UNVERIFIED";exports.mock="UNVERIFIED";',
      );
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          name: 'af-baseline',
          exports: {
            '.': './override.cjs',
            './providers': './override.cjs',
          },
        }),
      );
      expect(modules(dir, 'baseline')).toMatchObject({ Agent: 'verified', mock: 'verified' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('the pinned SDK ignores root self-reference and accepts fractional remaining deadlines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-pilot-sdk-self-reference-'));
    try {
      symlinkSync(join(process.cwd(), 'node_modules'), join(dir, 'node_modules'), 'dir');
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: '@anthropic-ai/sdk', exports: { '.': './override.cjs' } }),
      );
      writeFileSync(
        join(dir, 'override.cjs'),
        'exports.default=class{constructor(){throw new Error("UNVERIFIED SDK EXECUTED")}};',
      );
      const network = vi.fn(
        async () =>
          new Response(JSON.stringify({ content: [], usage: {} }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      );
      await liveTransport(
        dir,
        'synthetic-not-a-secret',
        network,
      )(
        {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'synthetic' }],
        },
        { timeout: 500.125, signal: new AbortController().signal },
      );
      expect(network).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('bad execution approval is refused before package or live client loading', async () => {
    const live = vi.fn();
    await expect(
      pilot({
        consumer: 'missing-consumer',
        output: 'must-not-exist.json',
        execute: true,
        approvedManifest: 'wrong',
        getLiveTransport: live,
      }),
    ).rejects.toThrow(/approval/);
    expect(live).not.toHaveBeenCalled();
  });
  it.each(['lookup', 'conflict'])(
    'the actual engine completes the scripted %s fixture with a summary only',
    async (scenario) => {
      const events = [];
      const budget = pilotBudget({
        journal: (e) => {
          events.push(e);
        },
      });
      const result = await runArm({
        api,
        arm: 'candidate',
        scenarioId: scenario,
        budget,
        partition: `stable-${scenario}-frozen-v1`,
      });
      expect(result.ended).toBe('complete');
      expect(result.plantedFidelity).toBe(true);
      expect(result.answerCheck).toEqual({ form: 'bare-json', answer: 'exact', reads: 'expected' });
      expect(result.referenceRefusals).toBe(0);
      expect(result.toolsStable).toBe(true);
      expect(result.systemStable).toBe(true);
      expect(result.recordedIdentifiedStandingRows).toBeGreaterThan(0);
      expect(result.calls).toBe(scenario === 'lookup' ? 2 : 3);
      expect(Object.keys(result).sort()).toEqual(
        [
          'arm',
          'scenario',
          'ended',
          'calls',
          'reads',
          'plantedFidelity',
          'answerCheck',
          'referenceRefusals',
          'recordedIdentifiedStandingRows',
          'recordedUnknownStandingRows',
          'extraTurns',
          'requestHashes',
          'toolsStable',
          'systemStable',
        ].sort(),
      );
      expect(result).not.toHaveProperty('answer');
      expect(result).not.toHaveProperty('frames');
      expect(budget.snapshot().reservedMicroUsd).toBe(result.calls * RESERVATION_MICRO_USD);
      expect(
        events
          .filter((e) => e.kind === 'settled')
          .every((e) => e.usage.raw.cache_read_input_tokens === 0),
      ).toBe(true);
    },
  );
  it('does not retain a provider answer even when it is not valid fixture JSON', async () => {
    const sentinel = 'PRIVATE_PROVIDER_ANSWER_MUST_NOT_BE_SAVED';
    const result = await runArm({
      api,
      arm: 'candidate',
      scenarioId: 'lookup',
      partition: 'stable-lookup-frozen-v1',
      budget: pilotBudget({ journal() {} }),
      transport: async () => ({
        id: 'msg_summary_fixture',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5-20251001',
        content: [{ type: 'text', text: sentinel }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      }),
    });
    expect(result.ended).toBe('complete');
    expect(result.plantedFidelity).toBe(false);
    expect(result.answerCheck).toEqual({
      form: 'no-json-object',
      answer: 'missing',
      reads: 'fewer',
    });
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(result).not.toHaveProperty('answer');
    expect(result).not.toHaveProperty('frames');
    expect(result.requestHashes).toHaveLength(1);
  });
  it('the shared real-library canaries cover valid, unserved, ambiguous and same-batch IDs', async () => {
    expect(await canaries(api)).toEqual([
      { name: 'valid', executes: 2, refuses: 0 },
      { name: 'unserved', executes: 0, refuses: 1 },
      { name: 'ambiguous', executes: 2, refuses: 1 },
      { name: 'same-batch', executes: 1, refuses: 1 },
    ]);
  });
  it('a process killed at transport entry leaves a reservation and cannot reopen its allowance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-pilot-crash-')),
      path = join(dir, 'journal.ndjson');
    try {
      const module = pathToFileURL(join(process.cwd(), 'bench/cache/pilot/journal.mjs')).href;
      const guard = pathToFileURL(join(process.cwd(), 'bench/cache/pilot/budget.mjs')).href;
      const code = `import {openJournal} from ${JSON.stringify(
        module,
      )};import {pilotBudget,MODEL} from ${JSON.stringify(
        guard,
      )};const j=openJournal(${JSON.stringify(
        path,
      )});await pilotBudget({journal:e=>j.append(e)}).call({model:MODEL,max_tokens:1,messages:[{role:'user',content:'synthetic'}]},()=>process.exit(73),{arm:'baseline',run:'lookup'});`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
        timeout: 15000,
      });
      expect(child.status).toBe(73);
      const rows = readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(rows).toEqual([
        expect.objectContaining({ kind: 'reserved', microUsd: RESERVATION_MICRO_USD }),
      ]);
      expect(() => openJournal(path)).toThrow(/exist/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('the frozen kit includes the closure of its local literal imports and requires', () => {
    const pinned = new Set(KIT_FILES);
    const missing: string[] = [];
    for (const file of KIT_FILES) {
      const source = ts.createSourceFile(
        file,
        readFileSync(join(process.cwd(), file), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const inspect = (node: ts.Node) => {
        let target: ts.Node | undefined;
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
          target = node.moduleSpecifier;
        else if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
        ) {
          target = node.arguments[0];
          expect(target && ts.isStringLiteral(target), `nonliteral loader in ${file}`).toBe(true);
        }
        if (target && ts.isStringLiteral(target)) {
          if (target.text.startsWith('.')) {
            let dependency = posix.normalize(posix.join(posix.dirname(file), target.text));
            if (file.endsWith('.ts')) dependency = dependency.replace(/\.js$/, '.ts');
            if (!pinned.has(dependency)) missing.push(`${file} -> ${dependency}`);
          } else
            expect(
              target.text.startsWith('node:'),
              `bare dependency outside admitted consumer: ${file}`,
            ).toBe(true);
        }
        ts.forEachChild(node, inspect);
      };
      inspect(source);
    }
    // Nonliteral package loading is owned by pinnedModule(), after the separate full consumer-closure admission.
    expect(missing).toEqual([]);
  });
  it('pins the transitive UTF-8 byte counter used by the paid-request boundary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-pilot-kit-dependency-'));
    try {
      for (const path of new Set([...KIT_FILES, 'dist/lib/utf8.js', 'src/lib/utf8.ts'])) {
        const target = join(dir, path);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(process.cwd(), path), target);
      }
      const order = [
        { arm: 'candidate', scenario: 'lookup', partition: 'stable-lookup-frozen-v1' },
      ];
      const manifest = { kit: kitHashes(dir), order, payloadSha256: payloadHash(order) };
      expect(() => verifyKit(dir, manifest)).not.toThrow();
      const path = join(dir, 'dist/lib/utf8.js');
      writeFileSync(path, readFileSync(path, 'utf8') + '\nexports.utf8Length = () => 0;\n');
      expect(() => verifyKit(dir, manifest)).toThrow('pilot kit differs from reviewed manifest');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('closure admission catches edited files and links escaping the verified install', () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-pilot-identity-'));
    try {
      writeFileSync(join(dir, 'fixture.js'), 'export const fixture=1;');
      const before = closureHash(dir);
      writeFileSync(join(dir, 'fixture.js'), 'export const fixture=2;');
      expect(closureHash(dir)).not.toBe(before);
      symlinkSync(process.execPath, join(dir, 'outside-executable'));
      expect(() => closureHash(dir)).toThrow(/escapes/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('the actual SDK transport pins one destination, no redirects, no retries and bounded response bytes', async () => {
    const network = vi.fn(async (url, init) => {
      expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
      expect(init.redirect).toBe('error');
      return new Response(
        JSON.stringify({
          id: 'msg_synthetic',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-4-5-20251001',
          content: [{ type: 'text', text: 'synthetic' }],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const transport = liveTransport(process.cwd(), 'synthetic-not-a-secret', network);
    await transport(
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'synthetic' }],
      },
      { maxRetries: 0, timeout: 50, signal: new AbortController().signal },
    );
    expect(network).toHaveBeenCalledTimes(1);
    const unavailable = vi.fn(
      async () =>
        new Response('{"error":{"type":"overloaded_error","message":"synthetic"}}', {
          status: 529,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(
      liveTransport(
        process.cwd(),
        'synthetic-not-a-secret',
        unavailable,
      )(
        {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'synthetic' }],
        },
        { maxRetries: 0, timeout: 50 },
      ),
    ).rejects.toThrow();
    expect(unavailable).toHaveBeenCalledTimes(1);
    const oversized = vi.fn(
      async () =>
        new Response('x'.repeat(131073), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(
      liveTransport(
        process.cwd(),
        'synthetic-not-a-secret',
        oversized,
      )(
        {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'synthetic' }],
        },
        { maxRetries: 0, timeout: 500 },
      ),
    ).rejects.toThrow();
    expect(oversized).toHaveBeenCalledTimes(1);
  });
});

// L-63: the strict literal check reported `false` for all four paid runs, and the report could not
// say whether the answer was wrong or right in another form. The cases below replay replies a real
// model writes through the actual engine and pin the closed label each one earns.
const FORMS = ['bare-json', 'fenced-json', 'embedded-json', 'no-json-object', 'no-answer'];
const ANSWERS = ['exact', 'reworded', 'table-status', 'superseded-status', 'other', 'missing'];
const READS = ['expected', 'fewer', 'more'];
type ScenarioId = 'lookup' | 'conflict';
interface Planted {
  key: string;
  live: string;
  table: string;
  superseded: string | undefined;
  reads: number;
}
/** The inventory's own status column, read here without the fixture's helper. */
function tableStatusOf(key: string): string {
  const [header, ...rows] = lookupTable().split('\n');
  const row = rows.find((r: string) => r.startsWith(`${key} | `));
  if (!row) throw new Error(`no inventory row for ${key}`);
  return row.split(' | ')[header.split(' | ').indexOf('status')];
}
function scenarioOf(id: ScenarioId) {
  const scenario = scenarios.find((s: { id: string }) => s.id === id);
  if (!scenario) throw new Error(`no scenario ${id}`);
  return scenario;
}
function planted(id: ScenarioId): Planted {
  const s = scenarioOf(id);
  return {
    key: s.key,
    live: s.expected,
    table: tableStatusOf(s.key),
    superseded: s.reads > 1 ? observation(s, 1).status : undefined,
    reads: s.reads,
  };
}
const usage = {
  input_tokens: 1,
  output_tokens: 1,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};
function wire(content: unknown[], stop: string) {
  return {
    id: 'msg_replay',
    type: 'message',
    role: 'assistant',
    model: MODEL,
    content,
    stop_reason: stop,
    usage,
  };
}
/** A well-formed `_findings` declaration citing the served readings, as the live runs wrote it. */
function findingsFor(p: Planted, ids: string[]) {
  return {
    basis: 'direct',
    previous: ids.map((toolCallId, i) =>
      i < ids.length - 1
        ? { toolCallId, standing: 'ruled-out', line: 'superseded by the later reading' }
        : {
            toolCallId,
            standing: 'fact',
            assertions: [
              { subject: { kind: 'relay', id: p.key }, predicate: 'status', value: p.live },
            ],
          },
    ),
  };
}
const json = (p: Planted, ids: string[], fields: Record<string, unknown>, indent?: number) =>
  JSON.stringify({ ...fields, _findings: findingsFor(p, ids) }, null, indent);
const exact = (p: Planted) => ({ answer: `${p.key} ${p.live}` });
const fence = (body: string) => '```json\n' + body + '\n```';
interface Replay {
  batched?: boolean;
  readCount?: number;
  fail?: boolean;
}
/** Replays a model through the real engine: its reads (one per turn, or all in one turn), then `final`. */
async function replay(
  id: ScenarioId,
  final: (p: Planted, ids: string[]) => string,
  options: Replay = {},
) {
  const p = planted(id);
  const ids = Array.from(
    { length: options.readCount ?? p.reads },
    (_, i) => `toolu_replay_${i + 1}`,
  );
  const turns = options.batched ? [ids] : ids.map((one) => [one]);
  let step = 0;
  return runArm({
    api,
    arm: 'candidate',
    scenarioId: id,
    partition: `stable-${id}-frozen-v1`,
    budget: pilotBudget({ journal() {} }),
    transport: async () => {
      if (options.fail) throw new Error('synthetic transport failure');
      const turn = turns[step++];
      return turn
        ? wire(
            turn.map((tid) => ({
              type: 'tool_use',
              id: tid,
              name: 'lookup',
              input: { key: p.key },
            })),
            'tool_use',
          )
        : wire([{ type: 'text', text: final(p, ids) }], 'end_turn');
    },
  });
}
interface Outcome {
  fidelity: boolean;
  form: string;
  answer: string;
  reads: string;
  calls?: number;
}
const pass = { fidelity: true, form: 'bare-json', answer: 'exact', reads: 'expected' };
const rows: [ScenarioId, string, (p: Planted, ids: string[]) => string, Replay, Outcome][] = [
  ['lookup', 'bare JSON', (p, ids) => json(p, ids, exact(p)), {}, { ...pass, calls: 2 }],
  ['lookup', 'pretty-printed bare JSON', (p, ids) => json(p, ids, exact(p), 2), {}, pass],
  ['conflict', 'reads in two turns', (p, ids) => json(p, ids, exact(p)), {}, { ...pass, calls: 3 }],
  [
    'conflict',
    'both reads batched in one turn, as the live model did',
    (p, ids) => json(p, ids, exact(p)),
    { batched: true },
    { ...pass, calls: 2 },
  ],
  [
    'lookup',
    'a ```json fence around the right answer',
    (p, ids) => fence(json(p, ids, exact(p), 2)),
    {},
    { ...pass, fidelity: false, form: 'fenced-json' },
  ],
  [
    'conflict',
    'a bare fence around the right answer, reads batched',
    (p, ids) => '```\n' + json(p, ids, exact(p)) + '\n```',
    { batched: true },
    { ...pass, fidelity: false, form: 'fenced-json' },
  ],
  [
    'lookup',
    'one prose line, then the right JSON',
    (p, ids) => `The live reading of ${p.key} is ${p.live}.\n\n` + json(p, ids, exact(p), 2),
    {},
    { ...pass, fidelity: false, form: 'embedded-json' },
  ],
  [
    'conflict',
    'prose, a fenced block and a closing line, reads batched',
    (p, ids) =>
      `I read ${p.key} twice; the second reading wins.\n\n` +
      fence(json(p, ids, exact(p), 2)) +
      '\nThat is the latest status.',
    { batched: true },
    { ...pass, fidelity: false, form: 'embedded-json' },
  ],
  [
    'lookup',
    'the right status, reworded',
    (p, ids) => json(p, ids, { answer: `${p.key} is ${p.live.toUpperCase()}` }),
    {},
    { ...pass, fidelity: false, answer: 'reworded' },
  ],
  [
    'lookup',
    'the right status as "<key>: <status>"',
    (p, ids) => json(p, ids, { answer: `${p.key}: ${p.live}` }),
    {},
    { ...pass, fidelity: false, answer: 'reworded' },
  ],
  [
    'lookup',
    'the static table status instead of the reading',
    (p, ids) => json(p, ids, { answer: `${p.key} ${p.table}` }),
    {},
    { ...pass, fidelity: false, answer: 'table-status' },
  ],
  [
    'conflict',
    'the static table status instead of the latest reading',
    (p, ids) => json(p, ids, { answer: `${p.key} ${p.table}` }),
    {},
    { ...pass, fidelity: false, answer: 'table-status' },
  ],
  [
    'conflict',
    'the superseded first reading',
    (p, ids) => json(p, ids, { answer: `${p.key} ${p.superseded}` }),
    {},
    { ...pass, fidelity: false, answer: 'superseded-status' },
  ],
  [
    'lookup',
    'a fence AND the table status: both axes report',
    (p, ids) => fence(json(p, ids, { answer: `${p.key} ${p.table}` }, 2)),
    {},
    { ...pass, fidelity: false, form: 'fenced-json', answer: 'table-status' },
  ],
  [
    'lookup',
    'two statuses named in one answer',
    (p, ids) => json(p, ids, { answer: `${p.key} ${p.table} in the table, ${p.live} live` }),
    {},
    { ...pass, fidelity: false, answer: 'other' },
  ],
  [
    'lookup',
    'JSON without an answer member',
    (p, ids) => json(p, ids, { status: p.live }),
    {},
    { ...pass, fidelity: false, answer: 'missing' },
  ],
  [
    'lookup',
    'prose only',
    (p) => `${p.key} is ${p.live} according to the live reading.`,
    {},
    { ...pass, fidelity: false, form: 'no-json-object', answer: 'missing' },
  ],
  [
    'lookup',
    'the right answer after reading twice',
    (p, ids) => json(p, ids, exact(p)),
    { readCount: 2 },
    { ...pass, fidelity: false, reads: 'more', calls: 3 },
  ],
  [
    'lookup',
    'a run that stopped before any answer',
    (p, ids) => json(p, ids, exact(p)),
    { fail: true },
    { fidelity: false, form: 'no-answer', answer: 'missing', reads: 'fewer' },
  ],
];
describe('findings pilot answer check (L-63): a format miss is not a wrong answer', () => {
  it.each(rows)('%s: %s', async (id, _name, final, options, outcome) => {
    const result = await replay(id, final, options);
    const { calls, fidelity, ...labels } = outcome;
    expect(result.plantedFidelity).toBe(fidelity);
    expect(result.answerCheck).toEqual(labels);
    if (calls !== undefined) expect(result.calls).toBe(calls);
    // The headline is the strict literal check, and it agrees with exactly one label triple.
    expect(result.plantedFidelity).toBe(
      result.answerCheck.form === 'bare-json' &&
        result.answerCheck.answer === 'exact' &&
        result.answerCheck.reads === 'expected',
    );
    expect(result.ended).toBe(options.fail ? 'stopped' : 'complete');
  });
  it('the label sets are closed and exactly these', () => {
    expect(ANSWER_FORMS).toEqual(FORMS);
    expect(ANSWER_VALUES).toEqual(ANSWERS);
    expect(READ_COUNTS).toEqual(READS);
    expect(Object.isFrozen(ANSWER_FORMS) && Object.isFrozen(ANSWER_VALUES)).toBe(true);
    expect(Object.isFrozen(READ_COUNTS)).toBe(true);
  });
  it('bounds the scan of a hostile reply', () => {
    const lookup = scenarioOf('lookup');
    const hostile = '{'.repeat(200_000) + '{"answer":"k064 green"}';
    // 64 object starts are tried, all unclosed, so the object after them is not reached.
    expect(answerCheck(hostile, lookup, 1)).toEqual({
      form: 'no-json-object',
      answer: 'missing',
      reads: 'expected',
    });
    const valid = '{"answer":"k064 green"}';
    expect(answerCheck('{x} '.repeat(63) + valid, lookup, 1)).toMatchObject({
      form: 'embedded-json',
      answer: 'exact',
    });
    expect(answerCheck('{x} '.repeat(64) + valid, lookup, 1)).toMatchObject({
      form: 'no-json-object',
      answer: 'missing',
    });
    expect(answerCheck('{x} {"answer":"k064 green"}', lookup, 1)).toEqual({
      form: 'embedded-json',
      answer: 'exact',
      reads: 'expected',
    });
  });
  it('calls wrappers embedded JSON and scalars no JSON object, without claiming there was prose or invalid JSON', () => {
    const scenario = scenarioOf('lookup');
    expect(answerCheck('[{"answer":"k064 green"}]', scenario, 1)).toEqual({
      form: 'embedded-json',
      answer: 'exact',
      reads: 'expected',
    });
    expect(answerCheck('true', scenario, 1)).toEqual({
      form: 'no-json-object',
      answer: 'missing',
      reads: 'expected',
    });
  });
  it('reports closed labels only: no reply text reaches the result', async () => {
    const prose = 'PRIVATE_PROSE_SENTINEL';
    const inner = 'PRIVATE_ANSWER_SENTINEL';
    const replies = [
      `${prose}\n{"answer":"${inner}"}`,
      fence(`{"answer":"${inner}"}`),
      `{"answer":"${inner}","${prose}":"${prose}"}`,
      `{"answer":{"${inner}":"${prose}"}}`,
      `${prose} {${prose}} {"answer":"${inner}"`,
      prose,
    ];
    for (const text of replies) {
      const result = await replay('lookup', () => text);
      expect(JSON.stringify(result)).not.toContain('SENTINEL');
      expect(Object.keys(result.answerCheck).sort()).toEqual(['answer', 'form', 'reads']);
      expect(FORMS).toContain(result.answerCheck.form);
      expect(ANSWERS).toContain(result.answerCheck.answer);
      expect(READS).toContain(result.answerCheck.reads);
      expect(result.plantedFidelity).toBe(false);
    }
  });
});
describe('findings pilot rehearsal is derived from served evidence (L-63)', () => {
  it.each([
    [{ status: 'amber' }, 'other'],
    [{ key: 'k999' }, 'other'],
  ])(
    'a damaged fixture %j fails the real-engine rehearsal despite the planted expectation',
    async (damage, answer) => {
      const damagedApi = {
        ...api,
        defineTool: (tool) =>
          defineTool({
            ...tool,
            execute: async (args, context) => ({
              ...(await tool.execute(args, context)),
              ...damage,
            }),
          }),
      };
      const result = await runArm({
        api: damagedApi,
        arm: 'candidate',
        scenarioId: 'lookup',
        partition: 'stable-lookup-frozen-v1',
        budget: pilotBudget({ journal() {} }),
      });
      expect(result.ended).toBe('complete');
      expect(result.reads).toBe(1);
      expect(result.calls).toBe(2);
      expect(result.plantedFidelity).toBe(false);
      expect(result.answerCheck).toEqual({ form: 'bare-json', answer, reads: 'expected' });
    },
  );
  it('the scripted finding assertions use each served observation instead of the fixture expectation', () => {
    const scenario = scenarioOf('conflict');
    const reply = scriptedReply(
      {
        messages: [
          {
            role: 'tool',
            toolCallId: 'old',
            content: JSON.stringify({ key: scenario.key, status: 'amber' }),
          },
          {
            role: 'tool',
            toolCallId: 'new',
            content: JSON.stringify({ key: scenario.key, status: 'green' }),
          },
        ],
      },
      scenario,
      3,
    );
    const final = JSON.parse(reply.content);
    expect(final.answer).toBe(`${scenario.key} green`);
    expect(
      final._findings.previous.map((row) => [
        row.toolCallId,
        row.standing,
        row.assertions[0].value,
      ]),
    ).toEqual([
      ['old', 'ruled-out', 'amber'],
      ['new', 'fact', 'green'],
    ]);
  });
});
describe('findings pilot prompt asks for exactly what the check reads (L-63)', () => {
  it.each(['lookup', 'conflict'] as const)(
    '%s plants a key whose table status differs from every live reading',
    (id) => {
      const s = scenarioOf(id);
      const p = planted(id);
      const readings = Array.from({ length: s.reads }, (_, i) => observation(s, i + 1).status);
      expect(readings.at(-1)).toBe(p.live);
      expect(readings).not.toContain(p.table);
    },
  );
  it('the conflict readings disagree, so an answer from the superseded one is visible', () => {
    const p = planted('conflict');
    expect(p.superseded).toBeDefined();
    expect(p.superseded).not.toBe(p.live);
  });
  it('the system text asks for exactly one bare JSON object with a <key> template and one literal example', () => {
    const text = systemText('stable-lookup-frozen-v1');
    const head = text.slice(0, text.indexOf('key | relay |'));
    expect(head).toContain('exactly one JSON object');
    expect(head).toContain('no prose');
    expect(head).toContain('no code fence');
    expect(head).toContain('{"answer":"<key> <status>"');
    expect(head).not.toContain('relay key');
    expect(head).toMatch(/\{"answer":"k\d{3} [a-z]+"/);
  });
  it.each(['lookup', 'conflict'] as const)(
    'the %s question repeats the format line, after the table',
    async (id) => {
      const s = scenarioOf(id);
      expect(s.question).toContain('exactly one JSON object');
      expect(s.question).toContain('no code fence');
      expect(s.question).toContain(`{"answer":"${s.key} <status>"`);
      const bodies: { system: unknown; messages: unknown[] }[] = [];
      const budget = pilotBudget({ journal() {} });
      await runArm({
        api,
        arm: 'candidate',
        scenarioId: id,
        partition: `stable-${id}-frozen-v1`,
        budget,
        transport: async (body: { system: unknown; messages: unknown[] }) => {
          bodies.push(body);
          return wire([{ type: 'text', text: '{}' }], 'end_turn');
        },
      });
      // The table is in the system block. The first user turn, which the model reads after it,
      // repeats the format line. (Only the library's own findings DATA frame may follow that turn.)
      expect(JSON.stringify(bodies[0].system)).toContain('key | relay |');
      expect(JSON.stringify(bodies[0].messages[0])).toContain('exactly one JSON object');
      expect(JSON.stringify(bodies[0].messages[0])).toContain(
        `{\\"answer\\":\\"${s.key} <status>\\"`,
      );
    },
  );
});

// P2: these are complete lexical forms, not a vocabulary of suspicious words.
const diagnosticStatuses = [
  ['lookup', 'expected', 'reworded'],
  ['lookup', 'tableStatus', 'table-status'],
  ['conflict', 'expected', 'reworded'],
  ['conflict', 'tableStatus', 'table-status'],
  ['conflict', 'superseded', 'superseded-status'],
] as const;
const unsupportedAnswers = [
  'k999 {status}',
  '{status}',
  '{KEY} {status}',
  'x{key} {status}',
  '{key}x {status}',
  '{key}0 {status}',
  '_{key} {status}',
  '{key}_ {status}',
  '{key}-k999 {status}',
  'k999-{key} {status}',
  '{key} {status}ish',
  '{key} {status}_other',
  '{key} is not {status}',
  'not {key} {status}',
  '{key} no {status}',
  '{key} is never {status}',
  "{key} isn't {status}",
  '{key} isn’t {status}',
  "{key} ain't {status}",
  "{key}'s not {status}",
  '{key} is non-{status}',
  '{key} is {status} only if checked',
  'if true {key} is {status}',
  '{key} is {status} unless checked',
  'maybe {key} is {status}',
  '{key} could be {status}',
  '{key} is {status}?',
  '{key} is {status}, probably',
  '{key} is {status}. This is conditional.',
  'The status for {key} is {status}',
  '"{key} is {status}"',
  '{key} is {status}\n',
  '{key}\nis {status}',
  '{key} is {status}\r',
  '{key} is {status}\u0000',
  '{key}\u00a0is {status}',
  '{key} is {status}\u2028',
  '{key} is {status}..',
];
describe.each(diagnosticStatuses)('bounded diagnostic grammar (P2): %s %s', (id, field, label) => {
  const scenario = scenarioOf(id);
  const status = field === 'superseded' ? scenario.readings[0] : scenario[field];
  const expand = (pattern: string) =>
    pattern
      .replaceAll('{key}', scenario.key)
      .replaceAll('{KEY}', scenario.key.toUpperCase())
      .replaceAll('{status}', status);
  it.each(unsupportedAnswers)('does not classify unsupported whole answer %j', (pattern) => {
    const answer = expand(pattern);
    expect(answerCheck(JSON.stringify({ answer }), scenario, scenario.reads)).toEqual({
      form: 'bare-json',
      answer: 'other',
      reads: 'expected',
    });
  });
  it.each([
    '{key} is {status}',
    '{key}: {status}',
    '{key}:{status}',
    '{key} : {status}',
    '{key} status is {status}',
    '{key} status: {status}',
    '{key} status:{status}',
    '\t{key}\tis\t{status}.\t',
  ])('recognizes only a supported literal form %j', (pattern) => {
    const answer = expand(pattern).replace(status, status.toUpperCase());
    expect(answerCheck(JSON.stringify({ answer }), scenario, scenario.reads)).toEqual({
      form: 'bare-json',
      answer: label,
      reads: 'expected',
    });
  });
  it('has a fixed 256-character whole-answer bound before normalization', () => {
    const answer = `${scenario.key} is ${status}`.padStart(256, ' ');
    expect(answerCheck(JSON.stringify({ answer }), scenario, scenario.reads).answer).toBe(label);
    expect(
      answerCheck(JSON.stringify({ answer: ' ' + answer }), scenario, scenario.reads).answer,
    ).toBe('other');
  });
});
