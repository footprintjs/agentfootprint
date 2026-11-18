// Probe: security page CATCHES row says "Rows that break their declared columns" is turned on with `resultColumns`.
// The site sample also sets checkColumnTypes: 'warn'. Run both, with and without the dial.
import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../src/index';
import { mock } from '../../src/doors/providers';

async function kinds(dial: 'warn' | undefined): Promise<string[]> {
  const flagged: string[] = [];
  const getRefund = defineTool({
    name: 'get_refund',
    description: 'Look up a refund.',
    inputSchema: { type: 'object', properties: {} },
    resultColumns: { orderId: 'string', amount: 'number' },
    execute: () => [{ orderId: 'A-1042', amount: 'a lot' }],
  });
  let call = 0;
  const provider = mock({
    respond: () => {
      call += 1;
      return call === 1 ? { content: '', toolCalls: [{ id: 'a', name: 'get_refund', args: {} }] } : { content: 'Done.' };
    },
  });
  const agent = Agent.create({ provider, model: 'mock', ...(dial && { checkColumnTypes: dial }) }).tool(getRefund).build();
  agent.on('agentfootprint.integrity.context_error', (event) => flagged.push(event.payload.kind));
  await agent.run({ message: 'go' });
  return flagged;
}

describe('probe: resultColumns alone', () => {
  it('flags only when checkColumnTypes is on', async () => {
    const without = await kinds(undefined);
    const withDial = await kinds('warn');
    console.log('WITHOUT_DIAL', JSON.stringify(without), 'WITH_DIAL', JSON.stringify(withDial));
    expect(withDial).toContain('column-type-mismatch');
    expect(without).not.toContain('column-type-mismatch');
  });
});
