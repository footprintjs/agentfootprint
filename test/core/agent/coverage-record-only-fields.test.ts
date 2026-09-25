/**
 * `short` and `kind` on a coverage item are RECORD-ONLY.
 *
 * A tool may give each coverage item a short plain form (`short`) and, on a
 * `notChecked` / `cannotCover` item, what kind of ground it is (`kind`:
 * `'existence' | 'scope'`). Both reach the EVENTS (`tools.absent`,
 * `tools.coverage_declared`), the tracked `coverageDeclared` rows and the
 * answer account — never the model's request. The dispatch door removes them
 * from what the model is served (`coverage/read.ts` · `servedToModel`, asked
 * at the entry of `stages/toolCalls.ts` · `afterMoment`, so every after-tool
 * link sees the served value) and stamps `tool_end.modelResult` where the two
 * differ.
 *
 * Test types (Convention 3):
 *   - BYTE LAW   — a run whose tools declare neither field records exactly
 *                  the bytes the tree recorded BEFORE this change, on all
 *                  five dispatch paths and four envelope shapes. The
 *                  reference was captured on the pre-change tree by:
 *                  AF_RECORD_ONLY_REFERENCE=update npx vitest run test/core/agent/coverage-record-only-fields.test.ts
 *   - SCENARIO   — a declaring tool, on each of the five paths × four shapes:
 *                  the model's requests equal the non-declaring run's byte for
 *                  byte; the record carries the fields; `modelResult` is
 *                  stamped; an after-tool link is handed the served value.
 *   - UNIT / SECURITY / EDGE — in `coverage-short-and-kind.test.ts`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ABSENCE_NOTE,
  Agent,
  absent,
  allow,
  ask,
  checkInApproved,
  coverage,
  defineTool,
  isPaused,
  pauseHere,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { bearer, type CredentialProvider } from '../../../src/identity.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

// ─── The harness ─────────────────────────────────────────────────────

/** The five dispatch paths (`toolCalls.ts`: the batch loop + four resume doors). */
type Path = 'batch' | 'ask' | 'check-in' | 'consent' | 'pause';
const PATHS: readonly Path[] = ['batch', 'ask', 'check-in', 'consent', 'pause'];

/** The envelope shapes that can carry a coverage item. */
type Shape = 'bare' | 'ledger' | 'nested' | 'foreign';
const SHAPES: readonly Shape[] = ['bare', 'ledger', 'nested', 'foreign'];

/** One item's declared extras, or nothing when the run declares none. */
const extra = (declare: boolean, short: string, kind?: 'existence' | 'scope') =>
  declare ? { short, ...(kind !== undefined && { kind }) } : {};

function lists(declare: boolean) {
  return {
    checked: [
      {
        what: 'vDisk and vm_rdm_map: every VM disk in the RVTools export dated 2026-09-19',
        why: 'the export is the only source this tool reads',
        ...extra(declare, 'every VM disk in the RVTools export'),
      },
    ],
    notChecked: [
      {
        what: 'whether that name is a storage array, and which VM disks are on it',
        why: 'this tool places disks, it does not list arrays',
        ...extra(declare, 'whether that name is a storage array', 'existence'),
      },
    ],
    cannotCover: [
      {
        what: 'hosts that are not VMware — AIX LPARs and physical servers',
        why: 'RVTools sees VMware only',
        ...extra(declare, 'hosts that are not VMware', 'scope'),
      },
    ],
  };
}

/** The value the tool (or, on the `pause` path, the person) hands back. */
export function envelopeOf(shape: Shape, declare: boolean): unknown {
  const l = lists(declare);
  const what = 'a VM disk in the RVTools export attributed to the array asked';
  if (shape === 'bare') return absent({ what, ...l });
  if (shape === 'ledger') return coverage({ volumes: 3 }, l);
  if (shape === 'nested') return coverage(absent({ what, ...l }), l);
  // A hand-built envelope — the shape a Python sidecar mints (snake_case lists).
  return {
    af_absent: true,
    outcome: 'nothing_found',
    looked_for: what,
    checked: l.checked,
    not_checked: l.notChecked,
    cannot_cover: l.cannotCover,
    retry_returns_the_same: true,
    note: ABSENCE_NOTE,
  };
}

interface Harness {
  readonly agent: Agent;
  readonly requests: LLMRequest[];
  readonly events: { type: string; payload: Record<string, unknown> }[];
  /** What each after-tool link call was handed as `result`. */
  readonly linkSaw: unknown[];
  readonly vault: { granted: boolean };
}

function build(path: Path, shape: Shape, declare: boolean, withLink: boolean): Harness {
  const requests: LLMRequest[] = [];
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const linkSaw: unknown[] = [];
  const vault = { granted: false };
  const inner = mock({
    replies: [{ toolCalls: [{ id: 'c1', name: 'place_disks', args: {} }] }, { content: 'done' }],
  });
  const provider = {
    name: inner.name,
    complete: async (req: LLMRequest): Promise<LLMResponse> => {
      requests.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
      return inner.complete(req);
    },
  };
  const credentials: CredentialProvider = {
    id: 'test-vault',
    getCredential: async () =>
      vault.granted
        ? { status: 'issued', credential: bearer('tok') }
        : {
            status: 'authorization-required',
            authorizationUrl: 'https://idp.example.test/authorize',
            sessionId: 'sess-1',
          },
  };
  const tool = defineTool({
    name: 'place_disks',
    description: 'places VM disks on arrays',
    inputSchema: { type: 'object', properties: {} },
    ...(path === 'check-in' && { checkIn: 'always' as const }),
    ...(path === 'consent' && { needs: { credential: 'billing', mode: 'user' as const } }),
    execute: () => {
      if (path === 'pause') pauseHere({ question: 'which array?' });
      return envelopeOf(shape, declare);
    },
  });
  let builder = Agent.create({
    provider,
    model: 'mock',
    ...(path === 'consent' && { credentials }),
  }).tool(tool);
  if (path === 'ask') {
    builder = builder.toolMiddleware({ name: 'gate', onToolCall: () => ask({ question: 'ok?' }) });
  }
  if (withLink) {
    builder = builder.toolMiddleware({
      name: 'recorder',
      onToolResult: (call) => {
        linkSaw.push(JSON.parse(JSON.stringify(call.result)));
        return allow();
      },
    });
  }
  const agent = builder.build();
  agent.on('*', (e) =>
    events.push({ type: e.type, payload: e.payload as unknown as Record<string, unknown> }),
  );
  return { agent, requests, events, linkSaw, vault };
}

/** Run, answer the pause the way its door expects, resume. */
async function drive(h: Harness, path: Path, shape: Shape, declare: boolean): Promise<unknown> {
  const first = await h.agent.run({ message: 'which apps run on SHPSTRPLPCL003?' });
  if (path === 'batch') return first;
  expect(isPaused(first)).toBe(true);
  if (!isPaused(first)) throw new Error('expected a pause');
  if (path === 'consent') {
    h.vault.granted = true;
    return h.agent.resume(first.checkpoint, undefined);
  }
  if (path === 'pause') return h.agent.resume(first.checkpoint, envelopeOf(shape, declare));
  return h.agent.resume(first.checkpoint, checkInApproved({ by: 'alice' }));
}

const RECORDED = new Set([
  'agentfootprint.stream.tool_start',
  'agentfootprint.stream.tool_end',
  'agentfootprint.tools.absent',
  'agentfootprint.tools.coverage_declared',
  'agentfootprint.agent.iteration_end',
]);

/** Everything a consumer can see of one run, timing removed. */
function recordOf(h: Harness): unknown {
  const state = (h.agent.getSnapshot()?.sharedState ?? {}) as Record<string, unknown>;
  return JSON.parse(
    JSON.stringify({
      requests: h.requests.map((r) => r.messages),
      eventTypes: h.events.map((e) => e.type),
      payloads: h.events
        .filter((e) => RECORDED.has(e.type))
        .map((e) => {
          const { durationMs: _timing, ...rest } = e.payload;
          return { type: e.type, payload: rest };
        }),
      history: state.history ?? [],
      coverageDeclared: state.coverageDeclared ?? [],
    }),
  );
}

const endOf = (h: Harness) =>
  h.events.find((e) => e.type === 'agentfootprint.stream.tool_end')!.payload;
const firstOf = (h: Harness, type: string) => h.events.find((e) => e.type === type)?.payload;

// ─── 1. BYTE LAW — declaring nothing records the pre-change bytes ─────

const REFERENCE = resolve(__dirname, 'reference/coverage-record-only-bytes.json');

describe('record-only fields — a run that declares neither is byte-identical to the tree before', () => {
  const cases = PATHS.flatMap((path) => SHAPES.map((shape) => [path, shape] as const));
  it.each(cases)('%s × %s', async (path, shape) => {
    const h = build(path, shape, false, false);
    expect(await drive(h, path, shape, false)).toBe('done');
    const record = recordOf(h);
    const key = `${path}/${shape}`;
    const all = existsSync(REFERENCE)
      ? (JSON.parse(readFileSync(REFERENCE, 'utf8')) as Record<string, unknown>)
      : {};
    if (process.env.AF_RECORD_ONLY_REFERENCE === 'update') {
      all[key] = record;
      mkdirSync(dirname(REFERENCE), { recursive: true });
      writeFileSync(REFERENCE, `${JSON.stringify(all, null, 2)}\n`);
      return;
    }
    expect(
      all[key],
      `no reference for '${key}' — generate it on the pre-change tree`,
    ).toBeDefined();
    expect(record).toEqual(all[key]);
    // And no stamp: the model read `result` itself.
    expect('modelResult' in endOf(h)).toBe(false);
  });
});

// ─── 2. SCENARIO — declared, recorded, never served ───────────────────

const text = (v: unknown): string => JSON.stringify(v);

describe('record-only fields — a declaring tool changes the record, never the request', () => {
  const cases = PATHS.flatMap((path) => SHAPES.map((shape) => [path, shape] as const));

  it.each(cases)('%s × %s: the model’s requests are byte-identical', async (path, shape) => {
    const plain = build(path, shape, false, true);
    const declaring = build(path, shape, true, true);
    expect(await drive(plain, path, shape, false)).toBe('done');
    expect(await drive(declaring, path, shape, true)).toBe('done');
    expect(declaring.requests.map(text)).toEqual(plain.requests.map(text));
    // History (what every later request is composed from) agrees too.
    const historyOf = (h: Harness) =>
      text((h.agent.getSnapshot()?.sharedState as { history?: unknown }).history);
    expect(historyOf(declaring)).toBe(historyOf(plain));
    expect(historyOf(declaring)).not.toContain('"short"');
    expect(historyOf(declaring)).not.toContain('"kind"');
  });

  it.each(cases)('%s × %s: the after-tool link is handed the served value', async (path, shape) => {
    const declaring = build(path, shape, true, true);
    await drive(declaring, path, shape, true);
    expect(declaring.linkSaw).toHaveLength(1);
    expect(text(declaring.linkSaw[0])).not.toContain('"short"');
    expect(text(declaring.linkSaw[0])).not.toContain('"kind"');
    const plain = build(path, shape, false, true);
    await drive(plain, path, shape, false);
    expect(declaring.linkSaw).toEqual(plain.linkSaw);
  });

  it.each(cases)(
    '%s × %s: tool_end keeps the tool’s answer and stamps what the model read',
    async (path, shape) => {
      const declaring = build(path, shape, true, false);
      await drive(declaring, path, shape, true);
      const end = endOf(declaring);
      expect(end.result).toEqual(envelopeOf(shape, true));
      expect(end.modelResult).toEqual(envelopeOf(shape, false));
    },
  );

  // The pause door serves a PERSON's answer, which is never read for
  // coverage (human values are not envelopes) — it is still stripped, above.
  const declaredPaths = PATHS.filter((p) => p !== 'pause');
  const recordCases = declaredPaths.flatMap((path) =>
    SHAPES.map((shape) => [path, shape] as const),
  );

  it.each(recordCases)(
    '%s × %s: the events and the tracked rows carry them',
    async (path, shape) => {
      const h = build(path, shape, true, false);
      await drive(h, path, shape, true);
      const expected = lists(true);
      const statements = h.events.filter(
        (e) =>
          e.type === 'agentfootprint.tools.absent' ||
          e.type === 'agentfootprint.tools.coverage_declared',
      );
      expect(statements.length).toBeGreaterThan(0);
      for (const s of statements) {
        expect(s.payload.checked).toEqual(expected.checked);
        expect(s.payload.notChecked).toEqual(expected.notChecked);
        expect(s.payload.cannotCover).toEqual(expected.cannotCover);
      }
      const rows = (h.agent.getSnapshot()?.sharedState as { coverageDeclared: unknown[] })
        .coverageDeclared as { checked: unknown; notChecked: unknown; cannotCover: unknown }[];
      expect(rows).toHaveLength(statements.length);
      for (const row of rows) {
        expect(row.notChecked).toEqual(expected.notChecked);
        expect(row.cannotCover).toEqual(expected.cannotCover);
      }
      expect(firstOf(h, 'agentfootprint.stream.tool_end')).toBeDefined();
    },
  );
});

// ─── 3. BOUNDARY — the serving paths are the ones this file drives ────

describe('record-only fields — every serving path goes through the one strip', () => {
  const SRC = resolve(__dirname, '../../../src');
  const source = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');

  it('toolCalls.ts calls the after-tool moment on exactly five paths, and the moment strips first', () => {
    const tc = source('core/agent/stages/toolCalls.ts');
    // The batch loop + the four resume doors (middleware-ask, check-in,
    // credential-consent, pauseHere/askHuman). A sixth serving path must be
    // added to PATHS above before this count moves.
    expect(tc.match(/await afterMoment\(scope, \{/g)).toHaveLength(PATHS.length);
    const body = tc.slice(tc.indexOf('const afterMoment = async'));
    const strip = body.indexOf('servedToModel(call.result)');
    expect(strip).toBeGreaterThan(-1);
    expect(strip).toBeLessThan(body.indexOf('runToolAfterChain('));
  });

  it('every other caller of readCoverageResult is a READER, not a serving path', () => {
    // Pinned list: a new caller must be judged — does it serve the envelope
    // to a model? If so it must serve `reading.served` (or go through
    // `afterMoment`) and be driven by this file.
    const PINNED = [
      'core/agent/findings/unsettled.ts', // servedAbsenceOf — reads what WAS served
      'core/agent/stages/toolCalls.ts', // declareCoverage — records; afterMoment serves
      'core/runbook/coverage.ts', // foldInnerCoverage — folds declared lists upward
      'lib/semantics/check.ts', // declaresCoverage — the build-time gate asks yes/no
    ];
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) {
          const code = readFileSync(full, 'utf8')
            .split('\n')
            .filter((line) => !/^\s*(\*|\/\/)/.test(line))
            .join('\n');
          if (/readCoverageResult\(/.test(code)) found.push(relative(SRC, full));
        }
      }
    };
    walk(SRC);
    expect(found.filter((f) => f !== 'core/agent/coverage/read.ts').sort()).toEqual(PINNED);
  });
});
