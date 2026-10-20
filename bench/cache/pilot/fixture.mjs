import { lookupTable } from '../verify-fixture.mjs';
export const scenarios = Object.freeze([
  {
    id: 'lookup',
    key: 'k017',
    reads: 1,
    expected: 'green',
    question: 'Read k017 once with lookup and report its live status. Cite the actual tool result.',
  },
  {
    id: 'conflict',
    key: 'k142',
    reads: 2,
    expected: 'red',
    question:
      'Read k142 twice with lookup before answering. The second reading supersedes the first. Report the latest status and cite its actual result; retire the superseded reading.',
  },
]);
export function systemText(partition) {
  return (
    `Synthetic cache partition ${partition}.\nAnswer only from lookup observations, not the static inventory status. ` +
    'Use findings declarations. Finish with JSON {"answer":"<relay key> <latest status>","_findings":{...}}. ' +
    'Never invent result IDs. The following deterministic inventory is background context, not live status.\n' +
    lookupTable()
  );
}
export function observation(scenario, number) {
  return {
    key: scenario.key,
    status: scenario.id === 'conflict' && number > 1 ? 'red' : 'green',
    observedAt: number > 1 ? '2026-01-01T10:01:00Z' : '2026-01-01T10:00:00Z',
    source: 'synthetic-local-fixture',
  };
}
export function scriptedReply(request, scenario, step) {
  const results = request.messages.filter((m) => m.role === 'tool');
  const previous = results.map((message, i) => ({
    toolCallId: message.toolCallId,
    standing: scenario.id === 'conflict' && i < results.length - 1 ? 'ruled-out' : 'fact',
    assertions: [
      {
        subject: { kind: 'relay', id: scenario.key },
        predicate: 'status',
        value: observation(scenario, i + 1).status,
      },
    ],
  }));
  return step <= scenario.reads
    ? {
        content: '',
        toolCalls: [
          {
            id: `toolu_fixture_${step}`,
            name: 'lookup',
            args: {
              key: scenario.key,
              ...(previous.length && { _findings: { basis: 'direct', previous } }),
            },
          },
        ],
      }
    : {
        content: JSON.stringify({
          answer: `${scenario.key} ${scenario.expected}`,
          _findings: { basis: 'direct', previous },
        }),
        toolCalls: [],
      };
}
