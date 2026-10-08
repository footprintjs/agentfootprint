/**
 * The tool boundary: a value the CALLING agent's policy selects, inside a
 * chart-backed tool's run, never reaches a record of the calling agent.
 *
 * A chart-backed tool (`flowchartAsTool` / `runbookAsTool`) runs its chart in
 * a run of its own, covered by the union of its own `redact` and the calling
 * run's (`ToolExecutionContext.redact`). What it hands the MODEL becomes its
 * RESULT — and the calling agent keeps that result in its own conversation:
 * its history, the tool's events, every recording and export built from them,
 * and whatever the model then says. So `core/servableSnapshot.ts` ·
 * `modelFacingState` decides the model's view by where the result lands:
 *
 *   - a calling policy NARROWER than the conversation (here `{ keys: ['apiKey'] }`):
 *     the model reads what the record reads — the placeholder — so the value
 *     never enters the calling run at all;
 *   - a calling policy that keeps the whole conversation out
 *     (`conversationRedaction()` or more): the model reads the real value, and
 *     the calling run's records keep the result out by their own names.
 *
 * Either way the value is in NO retained or served artifact of the calling
 * agent (`./everySurface.ts` · `servedArtifacts`) and not in the tool's kept
 * record. The control — no calling policy — shows the check is not vacuous.
 * The one named limit is the run's answer as its output (`run.exit`): an
 * answer that QUOTES the value carries it there, pinned below.
 */
import { flowChart } from 'footprintjs';
import type { RedactionPolicy } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import { Agent, flowchartAsTool } from '../../src/index.js';
import type { LLMProvider, LLMResponse } from '../../src/adapters/types.js';
import { mock } from '../../src/doors/providers.js';
import { innerRunsOf } from '../../src/doors/observe.js';
import { conversationRedaction } from '../../src/doors/security.js';
import { servedUnderPolicy } from '../../src/redaction/marker.js';
import { runnerLive } from '../../src/core/runnerLive.js';
import { locationsOf, withoutAnswerBoundary } from './fixture.js';
import { everySurface, servedArtifacts } from './everySurface.js';

const KEY = 'sk-BOUNDARY-SECRET-4242';

/** The calling agent: one call to the chart-backed tool, then an answer. */
function callingAgent(redact: RedactionPolicy | undefined, answer = 'Done.') {
  const chart = flowChart<{ apiKey: string; note: string }>(
    'Use the key',
    (scope) => {
      scope.apiKey = KEY;
      scope.note = 'used';
    },
    'use-key',
  ).build();
  const tool = flowchartAsTool({
    name: 'inner_chart',
    description: 'Runs the inner chart.',
    flowchart: chart,
    keepRecord: true,
    // The mapper hands the model the selected value outright.
    resultMapper: (snapshot) =>
      `key=${String(snapshot.values.apiKey)}; note=${String(snapshot.values.note)}`,
  });
  const modelSaw: string[] = [];
  const agent = Agent.create({
    provider: mock({
      respond: (req) => {
        const last = [...req.messages].reverse().find((m) => m.role === 'tool');
        if (last !== undefined) {
          modelSaw.push(String(last.content));
          return answer;
        }
        return { toolCalls: [{ id: 't1', name: 'inner_chart', args: {} }] };
      },
    }),
    model: 'm',
    ...(redact !== undefined && { redact }),
  })
    .tool(tool)
    .build();
  return { agent, tool, modelSaw };
}

/** Every artifact of the calling agent, and the tool's kept record, searched for the key. */
async function whereTheKeyIs(redact: RedactionPolicy | undefined, answer?: string) {
  const { agent, tool, modelSaw } = callingAgent(redact, answer);
  const surfaced = await everySurface(agent, 'use the key');
  const artifacts = await servedArtifacts(surfaced);
  return {
    modelSaw: modelSaw.join('\n'),
    inArtifacts: Object.entries(artifacts)
      .filter(([, value]) => locationsOf(value, KEY).length > 0)
      .map(([name]) => name),
    // With every copy of the ANSWER taken out: where the key still is.
    outsideTheAnswer: Object.entries(artifacts)
      .filter(([, value]) => {
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        return answer !== undefined && text.split(answer).join('').includes(KEY);
      })
      .map(([name]) => name),
    inStructuredRecordsBeyondTheOutput: [
      'snapshot',
      'narrative',
      'events',
      'recording',
      'audit',
    ].filter((name) => locationsOf(withoutAnswerBoundary(artifacts[name]), KEY).length > 0),
    inKeptRecord: locationsOf(innerRunsOf(tool)?.get('t1'), KEY).length > 0,
    keptRecordSaysServed: servedUnderPolicy(innerRunsOf(tool)?.get('t1')?.recording?.snapshot),
  };
}

describe('a chart-backed tool’s result: the boundary into the calling agent’s records', () => {
  it('CONTROL — with no calling policy the model reads the value and the records keep it', async () => {
    const at = await whereTheKeyIs(undefined);
    expect(at.modelSaw).toContain(KEY);
    expect(at.inArtifacts).toEqual(
      expect.arrayContaining(['snapshot', 'events', 'recording', 'audit', 'otel', 'bugReportZip']),
    );
    expect(at.inKeptRecord).toBe(true);
    expect(at.keptRecordSaysServed).toBe(false);
  });

  it('a calling policy narrower than the conversation: the model reads the record’s view', async () => {
    const at = await whereTheKeyIs({ keys: ['apiKey'] });
    // The value would otherwise ride the tool's result into the calling run's
    // history and events under names this policy does not select.
    expect(at.modelSaw).not.toContain(KEY);
    expect(at.modelSaw).toContain('key=REDACTED');
    expect(at.modelSaw).toContain('note=used');
    expect(at.inArtifacts).toEqual([]);
    expect(at.inKeptRecord).toBe(false);
    expect(at.keptRecordSaysServed).toBe(true);
  });

  it('a calling policy that keeps the conversation out: the model reads the real value, no record does', async () => {
    const at = await whereTheKeyIs(conversationRedaction({ keys: ['apiKey'] }));
    // The live model input is never redacted…
    expect(at.modelSaw).toContain(`key=${KEY}`);
    // …and the result it rode in on is kept out of every record by the
    // calling run's own names.
    expect(at.inArtifacts).toEqual([]);
    expect(at.inKeptRecord).toBe(false);
    expect(at.keptRecordSaysServed).toBe(true);
  });

  it('THE NAMED LIMIT: an answer that quotes the value carries it only as the run’s output', async () => {
    const at = await whereTheKeyIs(
      conversationRedaction({ keys: ['apiKey'] }),
      `The key was ${KEY}.`,
    );
    // The run's answer leaves its chart as a bare string, which footprintjs
    // serves as it is (`src/redaction/README.md`, "The answer as the run's
    // output"): the key is there, inside the answer and nowhere else…
    expect(at.inArtifacts.length).toBeGreaterThan(0);
    expect(at.outsideTheAnswer).toEqual([]);
    // …and in the structured records, only on the run's exit.
    expect(at.inStructuredRecordsBeyondTheOutput).toEqual([]);
  });
});

/**
 * The boundary holds only while the calling policy really keeps the whole
 * conversation out — including the copies a compaction keeps word for word
 * beside its summary (`AgentState.foldedSpans`). The tool's result is folded
 * there after the model read it.
 */
describe('a chart-backed tool’s result, folded by a compaction', () => {
  function compactingAgent(redact: RedactionPolicy) {
    const chart = flowChart<{ apiKey: string }>(
      'Use the key',
      (scope) => {
        scope.apiKey = KEY;
      },
      'use-key',
    ).build();
    const tool = flowchartAsTool({
      name: 'inner_chart',
      description: 'Runs the inner chart.',
      flowchart: chart,
      resultMapper: (snapshot) => `key=${String(snapshot.values.apiKey)}`,
    });
    const modelSaw: string[] = [];
    let call = 0;
    const provider: LLMProvider = {
      name: 'mock',
      complete: async (req): Promise<LLMResponse> => {
        call += 1;
        const last = [...req.messages].reverse().find((m) => m.role === 'tool');
        if (last !== undefined) modelSaw.push(String(last.content));
        const wantsTool = call <= 4;
        return {
          content: wantsTool ? '' : 'Done.',
          toolCalls: wantsTool ? [{ id: `t${call}`, name: 'inner_chart', args: {} }] : [],
          usage: { input: 100 * call, output: 5 },
          stopReason: 'end_turn',
        };
      },
    };
    const summarizer: LLMProvider = {
      name: 'mock-summarizer',
      complete: async (): Promise<LLMResponse> => ({
        content: 'EARLIER: the key was used.',
        toolCalls: [],
        usage: { input: 120, output: 20 },
        stopReason: 'end_turn',
      }),
    };
    const agent = Agent.create({ provider, model: 'm', maxIterations: 8, redact })
      .tool(tool)
      .compaction({ thresholdTokens: 250, summarizer, model: 'summarizer', keepRecentTurns: 2 })
      .build();
    return { agent, modelSaw };
  }

  async function run(redact: RedactionPolicy) {
    const { agent, modelSaw } = compactingAgent(redact);
    const surfaced = await everySurface(agent, 'use the key');
    const artifacts = await servedArtifacts(surfaced);
    // The run's live state (the library's own unexported tap): what the fold kept.
    const live = runnerLive(agent)?.liveState();
    return {
      modelSaw: modelSaw.join('\n'),
      folded: JSON.stringify(live?.foldedSpans ?? null),
      served: (agent.getLastSnapshot()?.sharedState as Record<string, unknown>).foldedSpans,
      inArtifacts: Object.entries(artifacts)
        .filter(([, value]) => locationsOf(value, KEY).length > 0)
        .map(([name]) => name),
    };
  }

  it('the vocabulary: the model reads the value, the fold keeps it, no record does', async () => {
    const at = await run(conversationRedaction({ keys: ['apiKey'] }));
    expect(at.modelSaw).toContain(`key=${KEY}`);
    // The fold happened, and its originals hold the tool's result…
    expect(at.folded).toContain(KEY);
    // …which every record keeps out by the vocabulary's own name.
    expect(at.served).toBe('REDACTED');
    expect(at.inArtifacts).toEqual([]);
  });

  it('a policy missing the fold’s name does not keep the conversation out: the model reads the record’s view', async () => {
    const vocabulary = conversationRedaction({ keys: ['apiKey'] });
    const older: RedactionPolicy = {
      ...vocabulary,
      keys: (vocabulary.keys ?? []).filter((k) => k !== 'foldedSpans'),
    };
    const at = await run(older);
    // Fails safe: the value never enters the calling run at all.
    expect(at.modelSaw).not.toContain(KEY);
    expect(at.modelSaw).toContain('key=REDACTED');
    expect(at.inArtifacts).toEqual([]);
  });
});
