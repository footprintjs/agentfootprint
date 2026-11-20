import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Agent, askHuman, defineTool, slidingWindow } from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import type { FlowchartCheckpoint } from 'footprintjs';
import { normalizeCallOccurrences } from '../../../helpers/normalizeCallOccurrences.js';
import { captureDigests } from './fixtures/answer-standing-af-15.0.1/capture.js';
import {
  askingBuilder,
  buildAdmission,
  captureControl,
  controlBuilder,
  QUESTION,
  RESUMED_ANSWER,
} from './fixtures/answer-standing-af-15.0.1/scenarios.js';
import main from './fixtures/answer-standing-af-15.0.1/current-main.json';
import published from './fixtures/answer-standing-af-15.0.1/published.json';

const library = { Agent, askHuman, defineTool, mock };

function removeMainAddition(control: object, path: readonly (string | number)[], value: unknown) {
  type Fields = Record<string | number, unknown>;
  const owner = path
    .slice(0, -1)
    .reduce<Fields>((record, key) => record[key] as Fields, control as Fields);
  const field = path.at(-1)!;
  expect(owner[field], path.join('/')).toEqual(value);
  delete owner[field];
}

it('PROPERTY — generated build configurations preserve admission from published 15.0.1', () => {
  expect(published.admission).toHaveLength(24);
  expect(published.admission.filter(({ refusal }) => refusal === null)).toHaveLength(18);
  expect(buildAdmission(library)).toEqual(published.admission);
});

it.each(['builder', 'options'] as const)(
  'REGRESSION — answer layer off through %s matches main and the published 15.0.1 bytes after reversing upstream additions',
  async (door) => {
    const builder = controlBuilder(library, door === 'options' ? { answerLayer: false } : {});
    const agent = (door === 'builder' ? builder.answerLayer(false) : builder).build();
    const observed = await captureControl(agent);
    const current = normalizeCallOccurrences(observed) as typeof observed;
    expect(captureDigests(current)).toEqual({ ...published.capture, ...main.capture });

    // Verify the historical capture after reversing only the audited main additions.
    const historical = JSON.parse(JSON.stringify(current)) as typeof observed;
    removeMainAddition(historical, main.rootTurnField, true);
    for (const path of main.occurrenceFields) {
      removeMainAddition(historical, path, [0, 0, 0, 1, 0]);
    }
    expect(captureDigests(historical)).toEqual(published.capture);
  },
);

it('SCENARIO — answering a question saved by 15.0.1 does not claim a check that never ran', async () => {
  const bytes = readFileSync(
    new URL('./fixtures/answer-standing-af-15.0.1/checkpoint.json', import.meta.url),
  );
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(published.checkpointSha256);
  const saved = JSON.parse(bytes.toString('utf8')) as FlowchartCheckpoint;
  expect(saved.pauseData).toMatchObject({ question: QUESTION });
  expect(saved.sharedState).not.toHaveProperty('honestyLayers');
  expect(saved.sharedState).not.toHaveProperty('findingsLedger');
  const agent = askingBuilder(library, true).build();
  const assessments: unknown[] = [];
  const turnEnds: unknown[] = [];
  agent.on('agentfootprint.answer.assessed', ({ payload }) => assessments.push(payload));
  agent.on('agentfootprint.agent.turn_end', ({ payload }) => turnEnds.push(payload));

  const answer = await agent.resume(saved, 'Group A');

  const assessment = {
    assessment: 'not-applicable',
    standing: 'not-assessed',
    reasons: [],
    checked: [
      { layer: 3, check: 'tool-coverage', ran: 0, of: 1 },
      { layer: 3, check: 'result-shape', ran: 0, of: 1 },
    ],
  };
  expect(answer).toBe(RESUMED_ANSWER);
  expect(assessments).toEqual([{ turn: 1, iteration: 2, ...assessment }]);
  expect(turnEnds).toEqual([
    expect.objectContaining({ finalContent: RESUMED_ANSWER, answerAssessment: assessment }),
  ]);
});

it('SCENARIO — the dropped turns of a windowed conversation do not supply a standing', async () => {
  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'lookup', args: {} }] },
        { content: 'There are no entries.' },
        { content: 'Acknowledged.' },
        { content: 'Still here.' },
      ],
    }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'lookup',
        description: 'Look up the entries.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => [],
      }),
    )
    .window(slidingWindow({ keepRecentTurns: 1 }))
    .build();
  const assessments: unknown[] = [];
  agent.on('agentfootprint.answer.assessed', ({ payload }) => assessments.push(payload));

  const first = await agent.run({ message: 'Which entries are there?' });
  const second = await agent.run({ message: 'Acknowledged?', continueFrom: agent.checkpoint()! });
  const third = await agent.run({ message: 'Still here?', continueFrom: agent.checkpoint()! });

  expect(first).toBe(
    'There are no entries.\n\n---\n\nNot sure — a lookup came back empty without saying what it searched.',
  );
  expect(second).toBe('Acknowledged.');
  expect(third).toBe('Still here.');
  const saved = agent.checkpoint()!;
  expect(saved.turnNumber).toBe(3);
  expect(saved.history).not.toContainEqual({ role: 'user', content: 'Which entries are there?' });
  expect(assessments).toEqual([
    expect.objectContaining({ turn: 1, standing: 'not-sure', reasons: ['empty-undeclared'] }),
    expect.objectContaining({ turn: 2, standing: 'not-assessed', reasons: [], checked: [] }),
    expect.objectContaining({ turn: 3, standing: 'not-assessed', reasons: [], checked: [] }),
  ]);
});
