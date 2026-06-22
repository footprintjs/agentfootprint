'use client';

import '@xyflow/react/dist/style.css';
import { useState } from 'react';
import { Agent, mock } from 'agentfootprint';
import { Lens, LensRecorder } from 'agentfootprint-lens';

/**
 * LIVE in-browser "Try it" for Dynamic ReAct. Clicking Run builds and runs the REAL
 * agentfootprint agent **in the browser** with a mock LLM (no network, no server) and
 * renders the live <Lens> as the ReAct loop traces, step by step. The mock adapts to
 * the typed input (it reads the city out of the question), so the trace responds to
 * what you ask. Latency is added so the loop is visibly live.
 *
 * Runs client-side because the agent is pure JS once the LLM is mocked — see the
 * `node:module` Turbopack alias in next.config (the only browser blocker).
 */

function parseCity(text: string): string {
  const m = text.match(/in\s+([A-Za-z .'-]+?)\s*[?.!]*$/i);
  const fallback = text.replace(/[?.!]/g, '').replace(/weather/i, '').trim() || 'San Francisco';
  return (m?.[1] ?? fallback).trim();
}

function buildAgent() {
  let turn = 0;
  let city = 'your city';
  const provider = mock({
    thinkingMs: 450, // visible "thinking" latency so the loop traces live
    respond: (req) => {
      turn += 1;
      if (turn === 1) {
        const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
        const text = typeof lastUser?.content === 'string' ? lastUser.content : '';
        city = parseCity(text);
        return { toolCalls: [{ id: 'w1', name: 'weather', args: { city } }] };
      }
      return { content: `${city}: sunny, 72°F — fetched live via the weather tool.` };
    },
  });

  return Agent.create({ provider, model: 'mock-llm', maxIterations: 4, reactMode: 'dynamic' })
    .system('You answer weather questions using the `weather` tool.')
    .tool({
      schema: {
        name: 'weather',
        description: 'Get current weather for a city.',
        inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
      },
      execute: async (args) => {
        await new Promise((r) => setTimeout(r, 400)); // visible tool latency
        return `${(args as { city: string }).city}: sunny, 72°F`;
      },
    })
    .build();
}

export default function DynamicReactTryItInner() {
  const [input, setInput] = useState('Weather in Tokyo?');
  const [recorder, setRecorder] = useState<LensRecorder | null>(null);
  const [agentInst, setAgentInst] = useState<ReturnType<typeof buildAgent> | null>(null);
  const [running, setRunning] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setAnswer(null);
    const agent = buildAgent();
    const rec = new LensRecorder();
    rec.observe(agent); // attaches the live flowchart recorder
    setAgentInst(agent); // pass the runner so <Lens> renders the composition flowchart
    setRecorder(rec); // mount <Lens> now → it re-renders as events fire
    try {
      const result = await agent.run({ message: input });
      setAnswer(typeof result === 'string' ? result : '(no answer)');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="tryit">
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={running}
          placeholder="Ask a weather question…"
          onKeyDown={(e) => e.key === 'Enter' && !running && run()}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid var(--af-border, #2a2a32)',
            background: 'var(--af-bg, #fff)',
            color: 'var(--af-fg, inherit)',
            fontSize: 14,
          }}
        />
        <button
          onClick={run}
          disabled={running}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: '1px solid var(--af-accent, #d97706)',
            background: running ? 'var(--af-bg-elev, #f3f3f3)' : 'var(--af-accent, #d97706)',
            color: running ? 'var(--af-fg-muted, #8c887e)' : '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: running ? 'default' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {running ? 'Running…' : 'Run ▶'}
        </button>
      </div>

      {recorder && (
        <div
          style={{
            height: 520,
            borderRadius: 12,
            overflow: 'hidden',
            border: '1px solid var(--af-border, #2a2a32)',
            background: 'var(--af-bg-elev, #fff)',
          }}
        >
          <Lens recorder={recorder} {...(agentInst ? { runner: agentInst } : {})} view="engineer" />
        </div>
      )}
      {answer && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 12px',
            borderRadius: 8,
            background: 'var(--af-bg-elev, #f6f6f6)',
            fontSize: 14,
          }}
        >
          <strong>Answer:</strong> {answer}
        </div>
      )}
      {!recorder && (
        <div style={{ fontSize: 13, color: 'var(--af-fg-muted, #8c887e)' }}>
          ↑ Edit the question and hit <strong>Run</strong> — the real agent runs here in your
          browser (mock LLM, no network) and traces live.
        </div>
      )}
    </div>
  );
}
