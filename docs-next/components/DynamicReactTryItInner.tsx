'use client';

import '@xyflow/react/dist/style.css';
import { useEffect, useState } from 'react';
import {
  Agent,
  mock,
  defineTool,
  defineSteering,
  defineInstruction,
  defineSkill,
  defineFact,
} from 'agentfootprint';
import { Lens, LensRecorder } from 'agentfootprint-lens';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';

/**
 * LIVE in-browser "Try it" for Dynamic ReAct. Shows the example's CODE inline,
 * with the Run button directly beneath it, then traces the SAME agent live in the
 * browser (mock LLM — no network, no server). That's the whole point: read the
 * code, hit Run, watch exactly that code run. Theme-aware (follows docs light/dark).
 */

// The code shown to the reader — a faithful, readable distillation of
// examples/context-engineering/05-dynamic-react.ts. `buildExampleAgent()` below
// IS this agent; Run traces it.
const EXAMPLE_CODE = `import { Agent, mock, defineTool, defineInstruction, defineSkill } from 'agentfootprint';

// A tool that redacts PII before any refund goes out.
const redactPii = defineTool({
  name: 'redact_pii',
  description: 'Redact emails / phone numbers.',
  execute: ({ text }) => text.replace(/[\\w.-]+@[\\w.-]+/g, '[EMAIL]'),
});

// The star of Dynamic ReAct: an Instruction that activates ONLY on the
// iteration AFTER redact_pii returned — on-tool-return context injection.
const postPii = defineInstruction({
  id: 'post-pii',
  activeWhen: (ctx) => ctx.lastToolResult?.toolName === 'redact_pii',
  prompt: 'Use the redacted text in your reply. Do not paraphrase the original.',
});

// A skill that unlocks process_refund only once it's read.
const billing = defineSkill({
  id: 'billing',
  description: 'Read for refunds. Unlocks process_refund.',
  body: 'Redact PII first with redact_pii, THEN call process_refund.',
  tools: [defineTool({
    name: 'process_refund',
    execute: ({ amount }) => \`Refund of $\${amount} issued.\`,
  })],
});

const agent = Agent.create({ provider: mock(), model: 'mock' })
  .system('You are a customer support assistant.')
  .tool(redactPii)
  .skill(billing)
  .instruction(postPii)
  .build();

await agent.run({ message: 'My account is alice@example.com — please refund $42' });`;

function buildExampleAgent() {
  // ── the example's tools / context controls (verbatim shape) ──
  const redactPii = defineTool({
    name: 'redact_pii',
    description: 'Redact personally-identifiable info (emails, phones).',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    execute: ({ text }: { text: string }) =>
      text.replace(/[\w.-]+@[\w.-]+/g, '[EMAIL]').replace(/\d{3}-\d{4}/g, '[PHONE]'),
  });

  const safety = defineSteering({
    id: 'safety',
    prompt: 'Never expose raw PII (emails, phone numbers) in your final answer.',
  });

  // The on-tool-return Instruction — fires ONLY the iteration after redact_pii ran.
  const postPii = defineInstruction({
    id: 'post-pii',
    description: 'Brief reminder to use the redacted text, not the original.',
    activeWhen: (ctx) => ctx.lastToolResult?.toolName === 'redact_pii',
    prompt: 'Use the redacted text in your reply. Do not paraphrase the original.',
  });

  const billingSkill = defineSkill({
    id: 'billing',
    description: 'Read for refunds / charges. Unlocks process_refund.',
    body: 'When refunding: redact PII first using redact_pii, THEN call process_refund.',
    tools: [
      defineTool({
        name: 'process_refund',
        description: 'Issue a refund. Args: { amount: number }.',
        inputSchema: { type: 'object', properties: { amount: { type: 'number' } } },
        execute: ({ amount }: { amount: number }) => `Refund of $${amount} issued.`,
      }),
    ],
  });

  const focusReminder = defineInstruction({
    id: 'focus',
    activeWhen: (ctx) => ctx.iteration >= 3,
    prompt: 'You have been working on this turn for several iterations. Wrap up the response now.',
  });

  const userProfile = defineFact({ id: 'user-profile', data: 'User: Alice Chen. Plan: Pro.' });

  // The example's scripted 4-iteration Dynamic ReAct flow (latency added so it
  // traces visibly live in the browser).
  let iter = 0;
  const provider = mock({
    thinkingMs: 420,
    respond: () => {
      iter += 1;
      switch (iter) {
        case 1:
          return {
            content: 'Loading billing skill.',
            toolCalls: [{ id: 'c1', name: 'read_skill', args: { id: 'billing' } }],
            usage: { input: 30, output: 8 },
          };
        case 2:
          return {
            content: 'Redacting PII first.',
            toolCalls: [
              { id: 'c2', name: 'redact_pii', args: { text: 'alice@example.com refund $42' } },
            ],
            usage: { input: 60, output: 8 },
          };
        case 3:
          return {
            content: 'Issuing refund.',
            toolCalls: [{ id: 'c3', name: 'process_refund', args: { amount: 42 } }],
            usage: { input: 90, output: 6 },
          };
        default:
          return {
            content:
              'Done. Refund of $42 issued for [EMAIL]. You should see it in 3-5 business days.',
            toolCalls: [],
            usage: { input: 100, output: 22 },
          };
      }
    },
  });

  return Agent.create({ provider, model: 'mock', maxIterations: 6 })
    .system('You are a customer support assistant.')
    .tool(redactPii)
    .steering(safety)
    .skill(billingSkill)
    .instruction(postPii)
    .instruction(focusReminder)
    .fact(userProfile)
    .build();
}

// The lens reads `--fp-*` CSS vars (dark defaults). We theme it to MATCH the
// docs: light values in light mode, dark values in dark mode — so the embed
// never looks out of place when the reader toggles the theme.
const LIGHT_THEME: React.CSSProperties = {
  ['--fp-bg-primary' as string]: '#ffffff',
  ['--fp-bg-secondary' as string]: '#f8fafc',
  ['--fp-bg-tertiary' as string]: '#eef2f7',
  ['--fp-bg-elevated' as string]: '#ffffff',
  ['--fp-text-primary' as string]: '#0f172a',
  ['--fp-text-secondary' as string]: '#475569',
  ['--fp-text-muted' as string]: '#94a3b8',
  ['--fp-border' as string]: '#e2e8f0',
  ['--fp-color-primary' as string]: '#6366f1',
};
const DARK_THEME: React.CSSProperties = {
  ['--fp-bg-primary' as string]: '#0b0b0f',
  ['--fp-bg-secondary' as string]: '#14141a',
  ['--fp-bg-tertiary' as string]: '#1c1c24',
  ['--fp-bg-elevated' as string]: '#16161d',
  ['--fp-text-primary' as string]: '#e8e8ea',
  ['--fp-text-secondary' as string]: '#b4b4bd',
  ['--fp-text-muted' as string]: '#8c887e',
  ['--fp-border' as string]: '#2a2a32',
  ['--fp-color-primary' as string]: '#818cf8',
};

/** Follow the docs theme (Fumadocs / next-themes toggles a `dark` class on <html>). */
function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains('dark'));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export default function DynamicReactTryItInner() {
  const isDark = useIsDark();
  const [input, setInput] = useState('My account is alice@example.com — please refund $42');
  const [recorder, setRecorder] = useState<LensRecorder | null>(null);
  const [agentInst, setAgentInst] = useState<ReturnType<typeof buildExampleAgent> | null>(null);
  const [running, setRunning] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setAnswer(null);
    const agent = buildExampleAgent();
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
  const c = isDark
    ? { codeBg: '#0d0d12', codeFg: '#dcdce4', border: '#2a2a32', chip: '#8c887e', inputBg: '#16161d', inputFg: '#e8e8ea', panelBg: '#0b0b0f' }
    : { codeBg: '#0f172a', codeFg: '#e2e8f0', border: '#e2e8f0', chip: '#64748b', inputBg: '#ffffff', inputFg: '#0f172a', panelBg: '#ffffff' };

  return (
    <div className="tryit">
      {/* ── The code, embedded inline + SYNTAX-HIGHLIGHTED — exactly what Run
            executes. DynamicCodeBlock = Fumadocs' client-side shiki highlighter,
            so it's real TS highlighting AND theme-aware (light/dark) for free. ── */}
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
        <span>examples/context-engineering/05-dynamic-react.ts</span>
        <span>mock LLM · no network · runs in your browser</span>
      </div>
      <div style={{ marginBottom: 10, maxHeight: 380, overflow: 'auto', borderRadius: 12 }}>
        <DynamicCodeBlock lang="ts" code={EXAMPLE_CODE} />
      </div>

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
