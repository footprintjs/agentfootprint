/**
 * A number in scientific notation grounds the same decimal
 * (`namesAndNumbersFromEvidence({ decimalRounding: true })`).
 *
 * The field case: a script printed a p-value as `1.12e-02` (the default
 * formatting of common numeric libraries) and the answer wrote `0.0112`. The
 * value was right; only the spelling differed, and the gate flagged it. The
 * same value returned as a JSON NUMBER already passed — `JSON.parse` turns it
 * into `0.0112` — so the gap was the result's TEXT (stdout).
 */
import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../../../src/index.js';
import { mock } from '../../../../src/providers.js';
import type { NamesAndNumbersOptions } from '../../../../src/core/agent/evidence/types.js';
import type { AgentEvidenceCheckedPayload } from '../../../../src/events/payloads.js';

const enabled: NamesAndNumbersOptions = { decimalRounding: true };

/**
 * One mock run: the tool returns `result` (a string is served as text, the way
 * a script's stdout is; anything else as JSON), then the model answers
 * `answer`. Returns every `evidence_checked` payload the run emitted.
 */
async function checksOf(
  result: unknown,
  answer: string,
  options: NamesAndNumbersOptions = enabled,
): Promise<AgentEvidenceCheckedPayload[]> {
  const tool = defineTool({
    name: 'run_script',
    description: 'Run the analysis script and return what it printed.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => result,
  });
  const provider = mock({
    respond: (request) =>
      request.messages.some((message) => message.role === 'tool')
        ? { content: answer }
        : { content: '', toolCalls: [{ id: 'run-1', name: 'run_script', args: {} }] },
  });
  const agent = Agent.create({ provider, model: 'mock' })
    .tool(tool)
    .namesAndNumbersFromEvidence(options)
    .build();
  const checks: AgentEvidenceCheckedPayload[] = [];
  agent.on('agentfootprint.agent.evidence_checked', ({ payload }) => checks.push(payload));
  await agent.run({ message: 'Is the effect significant?' });
  return checks;
}

describe('the field case, end to end', () => {
  it('stdout `1.12e-02` grounds the answer `0.0112`', async () => {
    const [check] = await checksOf(
      't = 2.54, p = 1.12e-02',
      'The effect is significant (p = 0.0112).',
    );
    expect(check?.unsupported).toEqual([]);
    expect(check?.action).toBe('grounded');
    expect(check?.carriedBy).toEqual([{ toolCallId: 'run-1', values: 1, only: 1 }]);
  });

  it('the same value returned as a JSON number already grounded it', async () => {
    const [check] = await checksOf(
      { t: 2.54, p: 1.12e-2 },
      'The effect is significant (p = 0.0112).',
    );
    expect(check?.unsupported).toEqual([]);
    expect(check?.action).toBe('grounded');
  });
});
