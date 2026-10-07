/**
 * Property — no selected value appears in any served or retained artifact, for
 * random policies and random payloads.
 *
 * A seeded generator (this repo carries no fast-check; `mulberry32` is the
 * precedent) builds, per case: a random tool-argument object and a random
 * tool-result object — nested, with keys drawn from a small vocabulary and a
 * unique secret at every leaf — a person's message and a model answer that
 * carry secrets of their own, and a random policy over the vocabulary.
 *
 * TWO laws, because footprintjs's rule decides two kinds of record two ways:
 *
 *   P1 — CONTENT-FREE. With the conversation's names selected (the README's
 *        list) plus a random set of field names, NO secret survives in any
 *        artifact: the served events, the recording (snapshot, events, recorder
 *        rows, packed form), the narrative, `getLastSnapshot()`. The one named
 *        limit — the answer as the chart's bare-string return, `run.exit`'s
 *        boundary payload — is removed first (`withoutAnswerBoundary`).
 *
 *   P2 — BY NAME, AT ANY DEPTH. With ONLY random field names selected (no
 *        conversation keys), a tool call's structured payloads — the
 *        `stream.tool_start` arguments and the `stream.tool_end` result, records
 *        handed out whole — never carry a leaf whose path a selected key names.
 *        (The same values inside the conversation TEXT are free text with no
 *        name; P1 is what keeps those out.)
 *
 * Reproduce a failure with the seed printed in the test name.
 */
import { describe, expect, it } from 'vitest';
import type { RedactionPolicy } from 'footprintjs';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { packRecording, recordRun } from '../../src/doors/observe.js';
import { leaksIn } from './fixture.js';
import { conversationRedaction } from '../../src/doors/security.js';

/** mulberry32 — a tiny seeded PRNG (the repo's precedent). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIELD_NAMES = ['ssn', 'email', 'phone', 'dob', 'note', 'zip', 'nickname', 'ref'] as const;

interface Generated {
  readonly value: Record<string, unknown>;
  /** Every leaf secret, with the keys on its path. */
  readonly leaves: readonly { readonly secret: string; readonly path: readonly string[] }[];
}

function generateObject(next: () => number, tag: string, depth = 0): Generated {
  const leaves: { secret: string; path: string[] }[] = [];
  let counter = 0;
  const build = (level: number, path: string[]): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    const width = 1 + Math.floor(next() * 3);
    for (let i = 0; i < width; i++) {
      const key = FIELD_NAMES[Math.floor(next() * FIELD_NAMES.length)] as string;
      if (key in out) continue;
      const nest = level < 2 && next() < 0.35;
      if (nest) {
        out[key] =
          next() < 0.5 ? build(level + 1, [...path, key]) : [build(level + 1, [...path, key])];
      } else {
        const secret = `SEC-${tag}-${counter++}-${Math.floor(next() * 1e9)}`;
        out[key] = secret;
        leaves.push({ secret, path: [...path, key] });
      }
    }
    return out;
  };
  const value = build(depth, []);
  return { value, leaves };
}

function generatePolicyNames(next: () => number): { keys: string[]; patterns: RegExp[] } {
  const keys: string[] = [];
  const patterns: RegExp[] = [];
  for (const name of FIELD_NAMES) {
    const roll = next();
    if (roll < 0.25) keys.push(name);
    else if (roll < 0.35) patterns.push(new RegExp(`^${name.slice(0, 2)}`, 'i'));
  }
  if (keys.length === 0 && patterns.length === 0) keys.push(FIELD_NAMES[0]);
  return { keys, patterns };
}

const selects = (names: { keys: string[]; patterns: RegExp[] }, key: string): boolean =>
  names.keys.includes(key) || names.patterns.some((p) => p.test(key));

interface CaseRun {
  readonly events: AgentfootprintEvent[];
  readonly recording: unknown;
  readonly agent: Agent;
}

async function runCase(
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  message: string,
  answer: string,
  redact: RedactionPolicy,
): Promise<CaseRun> {
  const tool = defineTool<Record<string, unknown>, unknown>({
    name: 'probe',
    description: 'a probe',
    inputSchema: { type: 'object', properties: {} },
    execute: () => result,
  });
  const agent = Agent.create({
    provider: mock({
      chunkDelayMs: 0,
      replies: [{ toolCalls: [{ id: 'c1', name: 'probe', args }] }, { content: answer }],
    }),
    model: 'mock',
    maxIterations: 4,
    redact,
  })
    .tool(tool)
    .build();
  const recorder = recordRun(agent);
  const events: AgentfootprintEvent[] = [];
  agent.on('*', (e) => events.push(e));
  await agent.run({ message });
  return { events, recording: recorder.toRecording(), agent };
}

const SEEDS_P1 = Array.from({ length: 24 }, (_, i) => 0x5eed0000 + i * 7919);
const SEEDS_P2 = Array.from({ length: 32 }, (_, i) => 0x0b5e0000 + i * 104729);

describe('P1 — content-free: no secret in any artifact, for random policies and payloads', () => {
  for (const seed of SEEDS_P1) {
    it(`seed ${seed}`, async () => {
      const next = rng(seed);
      const args = generateObject(next, `a${seed}`);
      const result = generateObject(next, `r${seed}`);
      const message = `MSG-${seed}-${Math.floor(next() * 1e9)}`;
      const answer = `ANS-${seed}-${Math.floor(next() * 1e9)}`;
      const names = generatePolicyNames(next);
      const redact: RedactionPolicy = conversationRedaction({
        keys: names.keys,
        patterns: names.patterns,
      });
      const run = await runCase(args.value, result.value, message, answer, redact);
      const secrets = [
        message,
        answer,
        ...args.leaves.map((l) => l.secret),
        ...result.leaves.map((l) => l.secret),
      ];
      const narrative = run.agent.getLastNarrativeEntries();
      expect(leaksIn(run.events, secrets)).toEqual([]);
      expect(leaksIn(run.recording, secrets)).toEqual([]);
      expect(leaksIn(packRecording(run.recording as never), secrets)).toEqual([]);
      expect(leaksIn(narrative, secrets)).toEqual([]);
      expect(leaksIn(run.agent.getLastSnapshot(), secrets)).toEqual([]);
    });
  }
});

describe('P2 — by name, at any depth: a tool call’s structured payloads', () => {
  for (const seed of SEEDS_P2) {
    it(`seed ${seed}`, async () => {
      const next = rng(seed);
      const args = generateObject(next, `a${seed}`);
      const result = generateObject(next, `r${seed}`);
      const names = generatePolicyNames(next);
      const run = await runCase(args.value, result.value, 'hello', 'done', {
        keys: names.keys,
        patterns: names.patterns,
      });
      const start = run.events.find((e) => e.type === 'agentfootprint.stream.tool_start');
      const end = run.events.find((e) => e.type === 'agentfootprint.stream.tool_end');
      expect(start).toBeDefined();
      expect(end).toBeDefined();
      const startArgs = JSON.stringify((start?.payload as { args?: unknown }).args ?? null);
      const endResult = JSON.stringify((end?.payload as { result?: unknown }).result ?? null);
      // A leaf is SELECTED when any key on its path is — footprintjs masks a
      // selected key whole, everything under it included.
      const selectedArgs = args.leaves.filter((l) => l.path.some((k) => selects(names, k)));
      const clearArgs = args.leaves.filter((l) => !l.path.some((k) => selects(names, k)));
      const selectedResult = result.leaves.filter((l) => l.path.some((k) => selects(names, k)));
      for (const leaf of selectedArgs) expect(startArgs).not.toContain(leaf.secret);
      for (const leaf of selectedResult) expect(endResult).not.toContain(leaf.secret);
      // Over-masking is not the claim: a leaf no selected key names is served.
      for (const leaf of clearArgs) expect(startArgs).toContain(leaf.secret);
    });
  }
});
