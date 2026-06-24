'use client';

import '@xyflow/react/dist/style.css';
import { useState, type ReactNode } from 'react';
import { Lens, LensRecorder } from 'agentfootprint-lens';
import { buildDynamicReactAgent } from './demos/dynamicReactDemo';
import { LIGHT_THEME, DARK_THEME, surfaceColors, useIsDark } from './demos/embedTheme';

/**
 * LIVE in-browser "Try it" for Dynamic ReAct. The code shown above the Run button
 * is the REAL builder — `components/demos/dynamicReactDemo.ts`, rendered verbatim at
 * build time via <CodeFile> (passed in as `code`). `buildDynamicReactAgent()` from
 * that SAME file is what Run executes and the lens traces. One source, zero drift:
 * read the code, hit Run, watch exactly that code run. Theme-aware (docs light/dark).
 */

interface DynamicReactTryItInnerProps {
  /**
   * The shown code block — a server-rendered <CodeFile region="demo"> of
   * components/demos/dynamicReactDemo.ts, passed down from the page so the bytes
   * on screen are read from the same file `buildDynamicReactAgent` lives in.
   */
  readonly code?: ReactNode;
}

export default function DynamicReactTryItInner({ code }: DynamicReactTryItInnerProps) {
  const isDark = useIsDark();
  const [input, setInput] = useState('My account is alice@example.com — please refund $42');
  const [recorder, setRecorder] = useState<LensRecorder | null>(null);
  const [agentInst, setAgentInst] = useState<ReturnType<typeof buildDynamicReactAgent> | null>(null);
  const [running, setRunning] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setAnswer(null);
    const agent = buildDynamicReactAgent();
    const rec = new LensRecorder();
    rec.observe(agent);
    setAgentInst(agent);
    setRecorder(rec);
    try {
      const result = await agent.run({ message: input });
      setAnswer(typeof result === 'string' ? result : '(no answer)');
    } finally {
      setRunning(false);
    }
  }

  // Theme-aware surface colours for the code block + chrome.
  const c = surfaceColors(isDark);

  return (
    <div className="tryit">
      {/* ── The code, embedded inline — read verbatim from the real builder file at
            build time (<CodeFile region="demo">), so it's exactly what Run executes.
            Read-only by design: edit the message below, not the code. ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
          margin: '0 2px 6px',
          fontSize: 12,
          color: c.chip,
        }}
      >
        <span>components/demos/dynamicReactDemo.ts — the exact agent that runs below</span>
        <span>mock LLM · no network · runs in your browser</span>
      </div>
      <div style={{ marginBottom: 10, maxHeight: 380, overflow: 'auto', borderRadius: 12 }}>{code}</div>

      {/* ── Run lives directly BELOW the code (+ an editable message). ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={running}
          placeholder="A customer support message…"
          onKeyDown={(e) => e.key === 'Enter' && !running && run()}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 8,
            border: `1px solid ${c.border}`,
            background: c.inputBg,
            color: c.inputFg,
            fontSize: 14,
          }}
        />
        <button
          onClick={run}
          disabled={running}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: '1px solid #6366f1',
            background: running ? (isDark ? '#1c1c24' : '#eef2f7') : '#6366f1',
            color: running ? '#94a3b8' : '#fff',
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
            ...(isDark ? DARK_THEME : LIGHT_THEME),
            height: 600,
            width: '100%',
            borderRadius: 12,
            overflow: 'hidden',
            border: `1px solid ${c.border}`,
            background: c.panelBg,
            colorScheme: isDark ? 'dark' : 'light',
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
            border: `1px solid ${c.border}`,
            background: isDark ? '#14141a' : '#f6f6f6',
            color: c.inputFg,
            fontSize: 14,
          }}
        >
          <strong>Answer:</strong> {answer}
        </div>
      )}
      {!recorder && (
        <div style={{ fontSize: 13, color: c.chip }}>
          ↑ Hit <strong>Run</strong> to execute the code above live (mock LLM, no network) and watch
          the on-tool-return reminder fire after <code>redact_pii</code>.
        </div>
      )}
    </div>
  );
}
