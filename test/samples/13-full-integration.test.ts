/**
 * Sample 13: Full Integration — Everything Composed
 *
 * Combines all agentfootprint features into realistic scenarios.
 * This is the "does it all work together?" regression test.
 */
import { describe, it, expect } from 'vitest';
import {
  Agent,
  LLMCall,
  RAG,
  FlowChart,
  Swarm,
  mock,
  mockRetriever,
  defineTool,
  agentAsTool,
  withRetry,
  withFallback,
} from '../../src';
import {
  QualityRecorder,
  GuardrailRecorder,
  CompositeRecorder,
  TurnRecorder,
} from '../../src/recorders/v2';
import { a2aRunner } from '../../src/adapters';

describe('Sample 13: Full Integration', () => {
  it('research pipeline: RAG → Agent → LLMCall', async () => {
    // Step 1: RAG retrieves context
    const rag = RAG.create({
      provider: mock([{ content: 'Key facts: AI is used in healthcare diagnostics.' }]),
      retriever: mockRetriever([
        {
          query: 'AI healthcare',
          chunks: [
            { content: 'AI diagnoses diseases with 95% accuracy.', score: 0.95 },
            { content: 'Machine learning reduces hospital readmissions.', score: 0.88 },
          ],
        },
      ]),
    })
      .system('Extract key facts from the retrieved documents.')
      .build();

    // Step 2: Agent with tools writes a draft
    const outlineTool = defineTool({
      id: 'create_outline',
      description: 'Create an article outline.',
      inputSchema: { type: 'object', properties: { topic: { type: 'string' } } },
      handler: async (input) => ({
        content: `Outline for "${input.topic}": 1. Intro 2. Applications 3. Conclusion`,
      }),
    });

    const writer = Agent.create({
      provider: mock([
        {
          content: 'Creating outline first.',
          toolCalls: [
            { id: 'tc1', name: 'create_outline', arguments: { topic: 'AI in Healthcare' } },
          ],
        },
        { content: 'Draft article about AI in healthcare.' },
      ]),
      name: 'writer',
    })
      .system('Write articles based on research.')
      .tool(outlineTool)
      .build();

    // Step 3: LLMCall polishes the draft
    const editor = LLMCall.create({
      provider: mock([{ content: 'Final polished article about AI in healthcare.' }]),
    })
      .system('Polish and improve the article.')
      .build();

    // Compose into a pipeline
    const pipeline = FlowChart.create()
      .agent('research', 'Research', rag)
      .agent('write', 'Write', writer)
      .agent('edit', 'Edit', editor)
      .build();

    const result = await pipeline.run('AI in healthcare');
    expect(result.content).toContain('polished article');
    expect(result.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('swarm with retry + fallback + quality monitoring', async () => {
    // Specialist agents
    const analyst: RunnerLike = {
      run: async (msg) => ({ content: `Analysis of: ${msg}` }),
    };

    // Wrap analyst with retry for reliability
    const reliableAnalyst = withRetry(analyst, { maxRetries: 2, backoffMs: 0 });

    // Fallback in case swarm fails
    const fallbackRunner: RunnerLike = {
      run: async () => ({ content: 'Fallback: basic analysis provided.' }),
    };

    // Quality monitoring
    const quality = new QualityRecorder((event) => ({
      score: event.content.length > 10 ? 0.9 : 0.3,
      turnNumber: event.turnNumber,
    }));

    // Guardrail check
    const guardrail = new GuardrailRecorder((event) => {
      if (event.content.toLowerCase().includes('error')) {
        return {
          rule: 'no-errors',
          message: 'Response mentions errors',
          turnNumber: event.turnNumber,
        };
      }
      return null;
    });

    const swarm = Swarm.create({
      provider: mock([
        {
          content: 'Delegating to analyst.',
          toolCalls: [{ id: 'tc1', name: 'analyze', arguments: { message: 'market data' } }],
        },
        { content: 'Analysis complete: Market is trending upward.' },
      ]),
    })
      .system('Route analysis tasks to specialists.')
      .specialist('analyze', 'Analyze data.', reliableAnalyst)
      .build();

    const resilientSwarm = withFallback(swarm, fallbackRunner);
    const result = await resilientSwarm.run('Analyze market trends');

    expect(result.content).toContain('Market is trending upward');
  });

  it('agent-as-tool: orchestrator calls specialist agents', async () => {
    // Specialist: research agent
    const researchAgent = Agent.create({
      provider: mock([{ content: 'Research: quantum computing uses qubits.' }]),
      name: 'researcher',
    })
      .system('You are a research specialist.')
      .build();

    // Specialist: summarizer
    const summarizerAgent = LLMCall.create({
      provider: mock([{ content: 'Summary: Quantum computing leverages qubits for computation.' }]),
    })
      .system('Summarize the input concisely.')
      .build();

    // Orchestrator uses specialists as tools
    const orchestrator = Agent.create({
      provider: mock([
        {
          content: 'Let me research this.',
          toolCalls: [{ id: 'tc1', name: 'research', arguments: { message: 'quantum computing' } }],
        },
        {
          content: 'Now summarizing.',
          toolCalls: [
            {
              id: 'tc2',
              name: 'summarize',
              arguments: { message: 'Research: quantum computing uses qubits.' },
            },
          ],
        },
        { content: 'Quantum computing uses qubits for powerful computation.' },
      ]),
    })
      .system('You are a project manager. Use specialists to answer questions.')
      .tool(
        agentAsTool({ id: 'research', description: 'Research a topic.', runner: researchAgent }),
      )
      .tool(
        agentAsTool({ id: 'summarize', description: 'Summarize text.', runner: summarizerAgent }),
      )
      .build();

    const result = await orchestrator.run('Explain quantum computing');
    expect(result.content).toContain('qubits');
  });

  it('mixed local + remote agents in FlowChart', async () => {
    // Remote agent via A2A
    const remoteTranslator = a2aRunner({
      client: {
        sendMessage: async (_, msg) => ({ content: `Translated: ${msg}` }),
      },
      agentId: 'translator-es',
    });

    // Local agent
    const localWriter = LLMCall.create({
      provider: mock([{ content: 'Article about technology.' }]),
    }).build();

    const pipeline = FlowChart.create()
      .agent('write', 'Write', localWriter)
      .agent('translate', 'Translate', remoteTranslator)
      .build();

    const result = await pipeline.run('Write about tech');
    expect(result.content).toBeTruthy();
  });

  it('full recorder stack on FlowChart', async () => {
    const turns = new TurnRecorder();
    const quality = new QualityRecorder((e) => ({
      score: 0.85,
      turnNumber: e.turnNumber,
    }));
    const guardrail = new GuardrailRecorder(() => null);
    const all = new CompositeRecorder([turns, quality, guardrail]);

    const a1 = Agent.create({
      provider: mock([{ content: 'Step 1.' }]),
      name: 'agent1',
    }).build();

    const a2 = Agent.create({
      provider: mock([{ content: 'Step 2.' }]),
      name: 'agent2',
    }).build();

    // Wire recorder into FlowChart via .recorder()
    const pipeline = FlowChart.create()
      .agent('a1', 'Agent1', a1)
      .agent('a2', 'Agent2', a2)
      .recorder(all)
      .build();

    const result = await pipeline.run('go');
    expect(result.content).toBeTruthy();

    // Recorder received turn events
    expect(turns.getCompletedCount()).toBe(1);
    expect(quality.getScores()).toHaveLength(1);
    expect(guardrail.hasViolations()).toBe(false);

    // Narrative covers all agents
    const narrative = pipeline.getNarrative();
    expect(narrative.length).toBeGreaterThan(0);

    // Snapshot enables drill-down
    const snapshot = pipeline.getSnapshot();
    expect(snapshot).toBeDefined();
  });
});

// Type helper for RunnerLike (used inline above)
interface RunnerLike {
  run(
    message: string,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<{ content: string }>;
}
