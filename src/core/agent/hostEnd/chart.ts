import { flowChart, type FlowChartBuilder } from 'footprintjs';
import type { AgentChartDeps } from '../chartContract.js';
import type { AgentState } from '../types.js';
import { mountAgentMemoryWrites } from '../memoryWrites.js';
import { finishHostReply } from './settle.js';

/** Select the terminal host path before recall, routing, tools or provider stages. */
export function mountHostTurn(builder: FlowChartBuilder, deps: AgentChartDeps): FlowChartBuilder {
  if (!deps.chooseHostTurn) return builder;
  const start = flowChart<AgentState>('Accepted host reply', () => undefined, 'host-accepted');
  const settled = mountAgentMemoryWrites(start, deps)
    .addFunction('Deliver host reply', finishHostReply, 'host-deliver')
    .build();
  return builder
    .addDeciderFunction('Who supplies this reply?', deps.chooseHostTurn, 'turn-author')
    .addSubFlowChartBranch('host', settled, 'Host', {
      inputMapper: (p) => ({
        finalContent: p.finalContent,
        newMessages: p.newMessages,
        runIdentity: p.runIdentity,
        turnNumber: p.turnNumber,
        contextTokensRemaining: p.contextTokensRemaining,
        turnStartMs: p.turnStartMs,
      }),
      outputMapper: (result) => ({ finalContent: result }),
      propagateBreak: true,
    })
    .addFunctionBranch('model', 'Continue agent turn', () => undefined)
    .setDefault('model')
    .end();
}
