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
import { mock } from '../../src/doors/providers.js';
import { innerRunsOf } from '../../src/doors/observe.js';
import { conversationRedaction } from '../../src/doors/security.js';
import { servedUnderPolicy } from '../../src/redaction/marker.js';
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
