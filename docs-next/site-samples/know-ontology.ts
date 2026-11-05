import { defineTool } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';

const lookupPort = defineTool({
  name: 'lookup_port',
  description: 'Look a switch port up.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => ({ port: 'fc1/7', state: 'up' }),
});
export const sent: string[] = [];
const provider = mock({
  respond: (request) => {
    sent.push(JSON.stringify(request));
    return { content: 'That rate is not in this result. The inventory holds the port, through lookup_port.' };
  },
});

// #region code
import { Agent } from 'agentfootprint';
import { defineOntology } from 'agentfootprint/ontology';

const map = defineOntology({
  id: 'fleet',
  version: '1',
  sources: {
    inventory: { meaning: 'the switch inventory export', configured: true },
  },
  nodes: {
    port: {
      meaning: 'a physical switch port',
      sources: [{ source: 'inventory', via: ['lookup_port'], coverage: 'every port on every switch' }],
    },
    port_error_rate: { meaning: 'CRC errors per minute on a port', unit: 'errors/min' },
  },
  edges: [{ from: 'port_error_rate', to: 'port', relation: 'measured-on' }],
});

const agent = Agent.create({ provider, model: 'mock' }).tool(lookupPort).ontology(map).build();
// #endregion code

await agent.run({ message: 'What is the error rate on fc1/7?' });
export const record = agent.getSnapshot()?.sharedState.ontology as { id: string; hash: string } | undefined;
