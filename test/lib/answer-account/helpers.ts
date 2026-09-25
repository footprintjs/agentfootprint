/**
 * Shared by the answer-account tests: the fixtures, neo's declarations, the
 * golden compare, and a text dump of an account (what a person reads).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect } from 'vitest';

import type { Recording } from '../../../src/recorders/observability/recordRun.js';
import type {
  AnswerAccount,
  AnswerAccountDeclarations,
  Sentence,
} from '../../../src/lib/answer-account/types.js';

export const HERE = __dirname;
export const FLAGSHIP_RUN_ID = 'run-1790361930311-2';

/** A · the real recording (reduced), as archived from the field. */
export function fixtureA(): Recording & { meta: { origin: { runId: string } } } {
  return JSON.parse(readFileSync(resolve(HERE, 'fixtures/turn2.recorded.json'), 'utf8'));
}

/** neo's declarations: a skill label, the wrapper shape of one lookup, "the app decides entries". */
export const NEO_DECLARATIONS: AnswerAccountDeclarations = Object.freeze({
  id: 'neo-seo',
  version: '1',
  skills: { 'array-inventory': { label: 'array estate report' } },
  tools: { powerstore_get_volumes: { rowsAt: 'volumes' } },
  routing: { appDecides: true },
});

type MutableEvent = { type: string; payload: Record<string, any>; meta: Record<string, any> };

/**
 * B · SYNTHETIC (named so): fixture A with every new af-1 field declared —
 * `short` / `kind` on `events[51]`'s items, `title` on the array-inventory
 * node, and `evidence_checked.lookedUp: 1` (one of the two candidates,
 * SHPSTRPLPCL003, is in the question, so it was exempt and never looked up).
 */
export function fixtureB(): Recording {
  const rec = fixtureA() as unknown as { events: MutableEvent[] };
  const absent = rec.events[51]!.payload;
  absent.checked[0].short = 'the array name, as this tool can place an array';
  absent.checked[1].short = 'every VM disk in the RVTools export of 2026-09-19';
  const shorts = [
    ['whether that name is a storage array', 'existence'],
    ['hosts that are not VMware', 'scope'],
    ['PowerMax array performance', 'scope'],
    ['VM disks this tool attributes to no array', 'scope'],
  ] as const;
  absent.notChecked.forEach((item: Record<string, unknown>, i: number) => {
    item.short = shorts[i]![0];
    item.kind = shorts[i]![1];
  });
  const node = rec.events[1]!.payload.nodes.find((n: { id: string }) => n.id === 'array-inventory');
  node.title = 'array estate report';
  rec.events[189]!.payload.lookedUp = 1;
  return rec as unknown as Recording;
}

/** One line per sentence: what the lens prints, with the template and voucher. */
export function dump(account: AnswerAccount): string {
  const line = (s: Sentence) =>
    `${s.item ? '    • ' : '  '}${s.text}  ⟨${s.template.id}@${s.template.version} · ${
      s.source
    } · ${s.status}${s.chips ? ` · ${s.chips.map((c) => c.text).join(' / ')}` : ''}⟩`;
  const out: string[] = [];
  for (const row of account.rows) {
    out.push(`${row.heading.text}:`);
    row.lines.forEach((s) => out.push(line(s)));
    if (row.more) out.push(line(row.more));
  }
  out.push(
    `In one line (${account.summary.tone}): ${account.summary.sentence.text}  ⟨${account.summary.sentence.source}⟩`,
  );
  return out.join('\n');
}

/** Byte-stable golden: compare to the checked-in file, or write it under AF_ANSWER_ACCOUNT_GOLDEN=update. */
export function golden(name: string, value: unknown): void {
  const file = resolve(HERE, 'golden', name);
  const text = typeof value === 'string' ? `${value}\n` : `${JSON.stringify(value, null, 1)}\n`;
  if (process.env.AF_ANSWER_ACCOUNT_GOLDEN === 'update') {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    return;
  }
  expect(
    existsSync(file),
    `no golden ${name} — write it with AF_ANSWER_ACCOUNT_GOLDEN=update`,
  ).toBe(true);
  expect(text).toBe(readFileSync(file, 'utf8'));
}

/** Every sentence of an account (rows, more, signals, unreachable, summary). */
export function sentencesOf(account: AnswerAccount): Sentence[] {
  return [
    ...account.rows.flatMap((r) => [r.heading, ...r.lines, ...(r.more ? [r.more] : [])]),
    ...account.signals.map((s) => s.sentence),
    ...account.unreachable.map((u) => u.sentence),
    account.summary.sentence,
  ];
}

/** Only the line sentences (not the row headings). */
export function linesOf(account: AnswerAccount): Sentence[] {
  return sentencesOf(account).filter(
    (s) => !s.template.id.startsWith('row.') || s.template.id === 'row.more',
  );
}

// ── pointer resolution (P1) and the allow-list property (P7) ─────────────

import {
  isShowable,
  showLeaves,
  SHOW_ME_ALLOW_LIST,
} from '../../../src/lib/answer-account/shown.js';
import type { RecordPointer, SentenceVar } from '../../../src/lib/answer-account/types.js';

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

function walk(value: unknown, path: string): unknown {
  let cur = value;
  for (const raw of path.split('/').slice(1)) {
    const seg = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(cur)) cur = cur[Number(seg)];
    else if (isObj(cur)) cur = cur[seg];
    else return undefined;
  }
  return cur;
}

/** The leaf a pointer names in `recording` (+ declarations), or `undefined` when it does not resolve. */
export function resolveLeaf(
  p: RecordPointer,
  recording: Recording,
  declarations: AnswerAccountDeclarations = {},
): { found: boolean; value?: unknown } {
  const events = recording.events as unknown as {
    type: string;
    payload: unknown;
    meta?: Record<string, unknown>;
  }[];
  const state = (
    isObj(recording.snapshot) && isObj(recording.snapshot.sharedState)
      ? recording.snapshot.sharedState
      : {}
  ) as Record<string, unknown>;
  const history = Array.isArray(state.history) ? state.history : [];
  const leafOk = (v: unknown) => v !== undefined && (v === null || typeof v !== 'object');
  switch (p.kind) {
    case 'event': {
      const e = events[p.index];
      if (e === undefined || e.type !== p.type) return { found: false };
      if (p.path === '#emptiness') return { found: isObj(e.payload) };
      if (p.path.startsWith('#meta/')) {
        const v = e.meta?.[p.path.slice(6)];
        return { found: leafOk(v), value: v };
      }
      const v = walk(e.payload, p.path);
      return { found: leafOk(v), value: v };
    }
    case 'state': {
      const v = p.path === '' ? state[p.key] : walk(state[p.key], p.path);
      return { found: leafOk(v), value: v };
    }
    case 'history': {
      const m = history[p.index];
      if (!isObj(m)) return { found: false };
      if (p.path === '#emptiness') return { found: true };
      const v = walk(m, p.path);
      return { found: leafOk(v), value: v };
    }
    case 'declaration': {
      const [head, ...rest] = p.field.split('.');
      const key = rest.slice(0, -1).join('.');
      const v =
        head === 'skills'
          ? declarations.skills?.[key]?.label
          : head === 'tools'
          ? declarations.tools?.[key]?.rowsAt
          : declarations.routing?.appDecides;
      return { found: v !== undefined, value: v };
    }
  }
}

/** P1 — every recorded line has a pointer, every pointer resolves, every `from` resolves to its value. */
export function assertP1(
  account: AnswerAccount,
  recording: Recording,
  declarations?: AnswerAccountDeclarations,
): void {
  for (const s of linesOf(account)) {
    if (s.status === 'recorded') {
      expect(s.pointers.length, `${s.template.id} is recorded but points nowhere`).toBeGreaterThan(
        0,
      );
      for (const p of s.pointers) {
        expect(
          resolveLeaf(p, recording, declarations).found,
          `${s.template.id} → ${JSON.stringify(p)}`,
        ).toBe(true);
      }
    }
    for (const [name, variable] of Object.entries(s.vars) as [string, SentenceVar][]) {
      if (variable.from === undefined) continue;
      const got = resolveLeaf(variable.from, recording, declarations);
      expect(got.found, `${s.template.id}.${name} from ${JSON.stringify(variable.from)}`).toBe(
        true,
      );
      if (variable.clipped) expect(String(got.value).startsWith(String(variable.value))).toBe(true);
      else expect(got.value, `${s.template.id}.${name}`).toBe(variable.value);
    }
  }
}

function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringLeaves(v, out));
  else if (isObj(value)) Object.values(value).forEach((v) => stringLeaves(v, out));
  return out;
}

/** Strings the record holds at a leaf "show me" may show. */
function allowedValues(recording: Recording, declarations: AnswerAccountDeclarations): Set<string> {
  const out = new Set<string>();
  const events = recording.events as unknown as { type: string; payload: unknown }[];
  events.forEach((e, index) => {
    const type = e.type.replace(/^agentfootprint\./, '');
    const patterns = SHOW_ME_ALLOW_LIST[type] ?? [];
    const visit = (value: unknown, path: string) => {
      if (typeof value === 'string') {
        if (isShowable({ kind: 'event', index, type: e.type, path })) out.add(value);
      } else if (Array.isArray(value)) value.forEach((v, i) => visit(v, `${path}/${i}`));
      else if (isObj(value)) Object.entries(value).forEach(([k, v]) => visit(v, `${path}/${k}`));
    };
    if (patterns.length > 0) visit(e.payload, '');
    // Every event of the run may show its run id (`#meta/runId`) — never its conversation id.
    const meta = (e as { meta?: Record<string, unknown> }).meta ?? {};
    for (const key of ['runId']) if (typeof meta[key] === 'string') out.add(meta[key] as string);
  });
  const state = (
    isObj(recording.snapshot) && isObj(recording.snapshot.sharedState)
      ? recording.snapshot.sharedState
      : {}
  ) as Record<string, unknown>;
  if (typeof state.userMessage === 'string') out.add(state.userMessage);
  // History rows show their tool name and call id (never their content).
  for (const m of Array.isArray(state.history) ? state.history : []) {
    if (!isObj(m)) continue;
    if (typeof m.toolName === 'string') out.add(m.toolName);
    if (typeof m.toolCallId === 'string') out.add(m.toolCallId);
  }
  stringLeaves(declarations).forEach((s) => out.add(s));
  // The names the app declared FOR (a tool, a skill id) are declared values too.
  [...Object.keys(declarations.skills ?? {}), ...Object.keys(declarations.tools ?? {})].forEach(
    (k) => out.add(k),
  );
  return out;
}

/** Leaves the response must never carry: injection bodies, args, results, `why`, `resumeInput`, a note, the heap. */
export function deniedLeaves(
  recording: Recording,
  declarations: AnswerAccountDeclarations = {},
): string[] {
  const denied: string[] = [];
  const events = recording.events as unknown as {
    type: string;
    payload: Record<string, unknown>;
  }[];
  for (const e of events) {
    // The conversation id is a key in an `open` door: it never leaves in an account.
    const sessionId = (e as { meta?: Record<string, unknown> }).meta?.sessionId;
    if (typeof sessionId === 'string') denied.push(sessionId);
    const p = isObj(e.payload) ? e.payload : {};
    const pick = (...keys: string[]) => keys.forEach((k) => stringLeaves(p[k], denied));
    if (e.type.endsWith('context.injected')) pick('rawContent', 'contentSummary', 'reason');
    if (e.type.endsWith('stream.tool_start')) pick('args');
    if (e.type.endsWith('stream.tool_end')) pick('result', 'modelResult');
    if (e.type.endsWith('middleware.decision')) pick('why');
    if (e.type.endsWith('pause.resume')) pick('resumeInput');
    if (e.type.endsWith('checkin.decision')) pick('note');
  }
  const state = (
    isObj(recording.snapshot) && isObj(recording.snapshot.sharedState)
      ? recording.snapshot.sharedState
      : {}
  ) as Record<string, unknown>;
  for (const [k, v] of Object.entries(state))
    if (k !== 'turnNumber' && k !== 'userMessage') stringLeaves(v, denied);
  // A denied leaf that also lives INSIDE a showable value (the array name in the person's own
  // question) is not a leak when the showable value prints it.
  const allowed = [...allowedValues(recording, declarations)];
  return [...new Set(denied)].filter(
    (s) => s.trim().length >= 8 && !allowed.some((a) => a.includes(s)),
  );
}

/** P7 — the whole response `{ account, shown }` is allow-listed and bounded. */
export function assertP7(
  account: AnswerAccount,
  recording: Recording,
  declarations: AnswerAccountDeclarations = {},
): void {
  const shown = showLeaves(account, recording, declarations);
  const response = JSON.stringify({ account, shown });
  for (const leaf of deniedLeaves(recording, declarations)) {
    expect(
      response.includes(JSON.stringify(leaf).slice(1, -1)),
      `denied leaf reached the response: ${leaf.slice(0, 80)}`,
    ).toBe(false);
  }
  for (const s of sentencesOf(account)) {
    for (const [name, variable] of Object.entries(s.vars) as [string, SentenceVar][]) {
      if (variable.from !== undefined) {
        expect(
          isShowable(variable.from),
          `${
            s.template.id
          }.${name} read from a leaf the allow-list does not admit: ${JSON.stringify(
            variable.from,
          )}`,
        ).toBe(true);
      } else if (typeof variable.value === 'string') {
        // A composed value (tool names, flagged values, "said by" words): each part is an allowed value.
        expect(
          ['names', 'values', 'who'].includes(name.split('.').pop()!),
          `${s.template.id}.${name} has no source pointer`,
        ).toBe(true);
      }
    }
  }
  expect(JSON.stringify(account).length).toBeLessThanOrEqual(128 * 1024);
  expect(response.length).toBeLessThanOrEqual(192 * 1024);
}
