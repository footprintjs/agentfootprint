import { describe, expect, it, vi } from 'vitest';
import { Agent, absent, defineTool } from '../../src/index.js';
import { defineSkill, keywordScorer, skillGraph } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, buildAccountFromView } from '../../src/answer-account/account.js';
import { bundleView } from '../../src/answer-account/bundleView.js';
import { validateDeclarations } from '../../src/answer-account/declarations.js';
import { recordAnswerAccountWithTools } from '../../src/answer-account/recordToolEvidence.js';
import { showLeaves } from '../../src/answer-account/shown.js';
import { projectInitialRouting } from '../../src/recorders/observability/answerAccount/routingEvidence.js';
import { recordAnswerAccount } from '../../src/recorders/observability/answerAccount/recorder.js';

const MAP = 'agentfootprint.skill.graph_declared';
const ROUTED = 'agentfootprint.skill.turn_routed';
const QUERY = 'Please answer the priority question.';
const ANSWER = 'Here is the answer for the priority desk.';
const DESCRIPTION = 'Unused catalog summary sentinel.';
const BODY = 'Unused private skill-body sentinel.';
const TITLE = 'Priority desk';

function build(observerDelivery: 'inline' | 'deferred', absence = false, covered = false) {
  const skill = defineSkill({
    id: 'priority',
    title: TITLE,
    description: DESCRIPTION,
    body: BODY,
  });
  const agent = Agent.create({
    model: 'mock',
    observerDelivery,
    ...(covered && { redact: { keys: ['userMessage'] } }),
    provider: mock({
      replies: [
        ...(absence ? [{ toolCalls: [{ id: 'empty-1', name: 'lookup', args: {} }] }] : []),
        { content: ANSWER },
      ],
    }),
  }).skillGraph(
    skillGraph()
      .entry(skill, { match: { keywords: ['priority'] } })
      .classify(keywordScorer())
      .build(),
  );
  if (absence) {
    agent.tool(
      defineTool({
        name: 'lookup',
        description: 'Read the fixture.',
        inputSchema: { type: 'object' },
        execute: () => absent({ what: 'mock result', checked: [{ what: 'mock catalog' }] }),
      }),
    );
  }
  return agent.build();
}

describe('in-memory initial routing evidence', () => {
  it.each(['menu', 'intent'] as const)(
    'keeps the recorded %s comparison and score positions',
    async (decision) => {
      const graph = skillGraph()
        .entry(defineSkill({ id: 'one', description: 'First entry.', body: BODY }), {
          match: { intent: 'asks for the first desk', examples: ['first desk please'] },
        })
        .entry(defineSkill({ id: 'two', description: 'Second entry.', body: BODY }), {
          match: { intent: 'asks for the second desk', examples: ['second desk please'] },
        })
        .classify({
          name: 'offline-tie',
          score: (_input, candidates) =>
            candidates.map(({ id }, index) => ({
              id,
              score: decision === 'menu' || index === 0 ? 1 : 0,
            })),
        })
        .build();
      const runner = Agent.create({ model: 'mock', provider: mock({ reply: ANSWER }) })
        .skillGraph(graph)
        .build();
      const observed = recordAnswerAccount(runner, 128 * 1024);
      try {
        await runner.run('Choose a desk.');
      } finally {
        observed.recording.stop();
      }
      const recording = observed.recording.toRecording();
      const whole = accountForAnswer(recording);
      expect(whole.facts.routing.verdict.value).toMatchObject({ by: decision });
      const bundle = observed.toSnapshot()!;
      const route = bundle.events.find(({ event }) => event.type === ROUTED)?.event.payload;
      if (decision === 'menu') expect(route?.offered).toEqual([null, null]);
      else {
        expect(route?.offered).toBeUndefined();
        expect(whole.facts.routing.scores.value).toMatchObject({ top: 1, next: 0, nextId: 'two' });
      }
      expect(route?.scores).toEqual([
        { id: 'one', score: 1 },
        { id: 'two', score: decision === 'menu' ? 1 : 0 },
      ]);
      const view = bundleView(bundle);
      expect(view).toBeDefined();
      const account = buildAccountFromView(view!, validateDeclarations(undefined));
      expect(JSON.stringify(account)).toBe(JSON.stringify(whole));
      expect(showLeaves(account, recording)).toEqual(showLeaves(whole, recording));
    },
  );

  it('bounds routing lists and refuses accessor-backed leaves without calling them', () => {
    const nodes = Array.from({ length: 256 }, (_, index) => ({ id: String(index) }));
    expect(projectInitialRouting(MAP, { nodes })).toEqual({ nodes });
    expect(() => projectInitialRouting(MAP, { nodes: [...nodes, { id: 'extra' }] })).toThrow(
      RangeError,
    );
    const getter = vi.fn(() => TITLE);
    const node = Object.defineProperty({ id: 'priority' }, 'title', { get: getter });
    expect(() => projectInitialRouting(MAP, { nodes: [node] })).toThrow(TypeError);
    expect(getter).not.toHaveBeenCalled();
  });

  it('withholds routing and all coordinates under the final served policy', async () => {
    const covered = async (message: string) => {
      const runner = build('inline', false, true);
      const observed = recordAnswerAccount(runner, 128 * 1024);
      try {
        await runner.run(message);
      } finally {
        observed.recording.stop();
      }
      const bundle = observed.toSnapshot()!;
      expect(bundle.gaps).toEqual(['redaction']);
      expect(bundle.events).toEqual([]);
      expect(observed.peakRetainedEventBytes).toBe(0);
      expect(bundleView(bundle)).toBeUndefined();
      return JSON.stringify(bundle);
    };
    expect(await covered(QUERY)).toBe(await covered('Different hidden priority request.'));
  });

  it.each(['inline', 'deferred'] as const)(
    'keeps the whole answer and shown pointers in %s',
    async (delivery) => {
      const runner = build(delivery);
      const observed = recordAnswerAccountWithTools(runner, 128 * 1024);
      try {
        expect(await runner.run(QUERY)).toBe(ANSWER);
      } finally {
        observed.recording.stop();
      }
      const recording = observed.recording.toRecording();
      const whole = accountForAnswer(recording);
      expect(whole.facts.routing.verdict.value).toMatchObject({ by: 'entry', to: 'priority' });
      const snapshot = observed.toSnapshot()!;
      expect(snapshot.gaps).toEqual([]);
      const encoded = JSON.stringify(snapshot);
      const view = bundleView(JSON.parse(encoded))!;
      expect(view).toBeDefined();
      const fromBundle = buildAccountFromView(view, validateDeclarations(undefined));
      expect(JSON.stringify(fromBundle)).toBe(JSON.stringify(whole));
      expect(showLeaves(fromBundle, recording)).toEqual(showLeaves(whole, recording));
      for (const type of [MAP, ROUTED]) {
        const index = recording.events.findIndex((event) => event.type === type);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(snapshot.events[index]?.event.type).toBe(type);
        expect(snapshot.events[index]?.index).toBe(index);
      }
      const map = snapshot.events.find(({ event }) => event.type === MAP)?.event;
      expect(map?.payload).toEqual({ nodes: [{ id: 'priority', title: TITLE }] });
      const routed = snapshot.events.find(({ event }) => event.type === ROUTED)?.event;
      expect(routed?.payload.witness).toEqual({ text: 'priority' });
      expect(encoded).not.toContain(DESCRIPTION);
      expect(encoded).not.toContain(BODY);
    },
  );

  it.each([MAP, ROUTED])('withholds when the accepted stream drops %s', async (missing) => {
    const runner = build('inline');
    const observed = recordAnswerAccount(runner, 128 * 1024, {}, (event) => event.type !== missing);
    try {
      await runner.run(QUERY);
    } finally {
      observed.recording.stop();
    }
    const snapshot = observed.toSnapshot()!;
    expect(snapshot.events.map(({ event }) => event.type)).toContain(
      'agentfootprint.agent.turn_end',
    );
    expect(snapshot.gaps).toEqual(['missing-routing-evidence']);
    expect(bundleView(snapshot)).toBeUndefined();
  });

  it('keeps an unsupported tool family unavailable even when the routing evidence was captured', async () => {
    const runner = build('inline', true);
    const observed = recordAnswerAccountWithTools(runner, 128 * 1024);
    try {
      await runner.run(QUERY);
    } finally {
      observed.recording.stop();
    }
    const snapshot = observed.toSnapshot()!;
    expect(
      snapshot.events.some(({ event }) => event.type === ROUTED && event.payload.by === 'entry'),
    ).toBe(true);
    expect(snapshot.gaps).toEqual(['tool-results', 'unsupported-evidence']);
    expect(bundleView(snapshot)).toBeUndefined();
  });
});
