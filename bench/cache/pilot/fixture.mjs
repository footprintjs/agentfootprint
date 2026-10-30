import { lookupTable } from '../verify-fixture.mjs';
/** The inventory's static status for one key. A planted key's live readings never equal it. */
export function tableStatus(key) {
  const [header, ...rows] = lookupTable().split('\n');
  const row = rows.find((r) => r.startsWith(`${key} | `));
  if (!row) throw new Error('pilot key is not in the inventory');
  return row.split(' | ')[header.split(' | ').indexOf('status')];
}
/** The one answer-format rule. The system block states it, and the user turn repeats it after the table. */
function finalFormat(key) {
  return (
    'Your final message must be exactly one JSON object and nothing else: no prose before or after it, ' +
    `no code fence. Write it as {"answer":"${key} <status>","_findings":{...}}, with the status in lower case.`
  );
}
function scenario({ id, key, readings, task }) {
  return Object.freeze({
    id,
    key,
    reads: readings.length,
    readings: Object.freeze(readings),
    expected: readings.at(-1),
    tableStatus: tableStatus(key),
    question: `${task}\n${finalFormat(key)}`,
  });
}
// L-63: the table says k064 is red and k145 is amber. The live readings say green, and green
// then red. An answer taken from the table, or from the superseded reading, cannot pass.
export const scenarios = Object.freeze([
  scenario({
    id: 'lookup',
    key: 'k064',
    readings: ['green'],
    task: 'Read k064 once with lookup. Answer with its live status from that reading and cite the reading in _findings.',
  }),
  scenario({
    id: 'conflict',
    key: 'k145',
    readings: ['green', 'red'],
    task:
      'Read k145 twice with lookup before answering. The second reading supersedes the first. ' +
      'Answer with the latest status, cite its reading in _findings and retire the superseded reading.',
  }),
]);
export function systemText(partition) {
  return (
    `Synthetic cache partition ${partition}.\nAnswer only from lookup observations, not the static inventory status. ` +
    'Use findings declarations. Never invent result IDs. ' +
    finalFormat('<key>') +
    ' Example of the form only (k999 is not in the inventory): {"answer":"k999 offline","_findings":{...}}.\n' +
    'The following deterministic inventory is background context, not live status.\n' +
    lookupTable()
  );
}
export function observation(scenario, number) {
  return {
    key: scenario.key,
    status: scenario.readings[Math.min(number, scenario.readings.length) - 1],
    observedAt: number > 1 ? '2026-01-01T10:01:00Z' : '2026-01-01T10:00:00Z',
    source: 'synthetic-local-fixture',
  };
}
/** The $0 rehearsal's model. It answers from the reading it was actually served, never from
 * `scenario.expected`, so a fixture that serves the wrong reading fails the rehearsal. */
export function scriptedReply(request, scenario, step) {
  const results = request.messages.filter((m) => m.role === 'tool');
  const served = results.map((message) => JSON.parse(message.content));
  const previous = results.map((message, i) => ({
    toolCallId: message.toolCallId,
    standing: scenario.id === 'conflict' && i < results.length - 1 ? 'ruled-out' : 'fact',
    assertions: [
      {
        subject: { kind: 'relay', id: served[i].key },
        predicate: 'status',
        value: served[i].status,
      },
    ],
  }));
  if (step <= scenario.reads)
    return {
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
    };
  const latest = served.at(-1);
  return {
    content: JSON.stringify({
      answer: `${latest.key} ${latest.status}`,
      _findings: { basis: 'direct', previous },
    }),
    toolCalls: [],
  };
}
