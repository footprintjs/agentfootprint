/**
 * 04 — Tool-choice margins at runtime (RFC-002 C4–C6).
 *
 * The runtime twin of the catalog lint: `toolChoiceRecorder` watches a
 * live agent run and, per LLM call, captures the MENU the model saw
 * (`stream.llm_start.tools`), what it actually invoked
 * (`stream.tool_start`), and the choice context (user message + latest
 * assistant reasoning — the C4 construction). On first read it ranks
 * the offered tools against that context via influence-core's
 * `scoreMargin`:
 *
 *   margin = score(best chosen) − score(best non-chosen)
 *
 * and flags fragile choices: `narrow` (margin < 0.05) and
 * `proxyDisagreement` (the proxy's top pick was not what the model
 * chose — always surfaced).
 *
 * THE LAZY CONTRACT ON DISPLAY: the embedder is wrapped in a counter —
 * after `agent.run()` it reports ZERO calls (event hooks only record);
 * the embeddings happen at `getCalls()` time, off the hot path.
 *
 * The scenario reuses the Neo fcns twins deliberately: an agent fielding
 * an ambiguous "did it drop recently?" question walks straight into the
 * confusable pair the lint (example 02) flagged at build time — the
 * margins quantify, per call, how close that competition actually was.
 *
 * Offline + deterministic: scripted mock provider, mock embedder
 * (proxy scores are embedding geometry — relative, not absolute).
 *
 * Run:  npx tsx examples/observability/04-tool-choice-margins.ts
 */

import { Agent, defineTool, mock, mockEmbedder, type LLMProvider } from '../../src/index.js';
import type { Embedder } from '../../src/lib/influence-core/index.js';
import {
  toolChoiceRecorder,
  type ToolChoiceCall,
  type ToolChoiceSummary,
} from '../../src/observe.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/04-tool-choice-margins',
  title: 'Runtime tool-choice margins + flags (RFC-002 C4–C6)',
  group: 'observability',
  description:
    'toolChoiceRecorder watches a scripted agent walk into the Neo fcns-twin trap: per LLM ' +
    'call it captures the offered menu, the chosen tool and the choice context, then scores ' +
    'margins LAZILY on first read (a counting embedder proves zero embedding calls during ' +
    'the run). Narrow margins and proxy disagreements are flagged; getSummary() gives the ' +
    'run-level counts.',
  defaultInput: null,
  providerSlots: [],
  tags: ['observability', 'tools', 'margins', 'recorder', 'lazy', 'rfc-002'],
};

// ── the twins from the lint examples, now live ───────────────────────

const fcnsLive = defineTool({
  name: 'get_fcns_database',
  description: 'FC Name Server (FCNS) DB — registered N_Ports in the fabric, live state.',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => ({ registered: ['21:00:00:24:ff:4a:12:03'] }),
});

const fcnsHistory = defineTool({
  name: 'influx_get_fcns_database',
  description: 'FC Name Server registrations (time-series) — membership history over time.',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => ({ lastSeen: '2026-06-09T22:14:00Z' }),
});

const sendEmail = defineTool({
  name: 'send_email',
  description: 'Sends a notification email to the on-call operator after triage completes.',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => 'sent',
});

/** Wrap an embedder so the run can PROVE no embedding rode the hot path. */
function countingEmbedder(inner: Embedder): Embedder & { calls: () => number } {
  let calls = 0;
  return {
    dimensions: inner.dimensions,
    embed: async (args) => ((calls += 1), inner.embed(args)),
    embedBatch: async (args) => ((calls += 1), inner.embedBatch!(args)),
    calls: () => calls,
  };
}

export interface ToolChoiceMarginsResult {
  readonly calls: readonly ToolChoiceCall[];
  readonly flagged: readonly ToolChoiceCall[];
  readonly summary: ToolChoiceSummary;
  readonly embedderCallsDuringRun: number;
  readonly transcript: string;
}

export async function run(_input?: string | null): Promise<ToolChoiceMarginsResult> {
  // Scripted model: ambiguous question → live lookup → history lookup → answer.
  let i = 0;
  const provider: LLMProvider = mock({
    respond: () => {
      i++;
      if (i === 1)
        return {
          content: 'I will check the live name server registrations first.',
          toolCalls: [{ id: 'c1', name: 'get_fcns_database', args: {} }],
          stopReason: 'tool_use',
        };
      if (i === 2)
        return {
          content: 'Still registered live — checking the membership history for a recent drop.',
          toolCalls: [{ id: 'c2', name: 'influx_get_fcns_database', args: {} }],
          stopReason: 'tool_use',
        };
      return {
        content: 'The WWPN is registered now and shows no drop in the recent history.',
        toolCalls: [],
        stopReason: 'stop',
      };
    },
  });

  const counter = countingEmbedder(mockEmbedder());
  const choices = toolChoiceRecorder({ embedder: counter });

  const agent = Agent.create({ provider, model: 'mock', maxIterations: 5 })
    .system('You are a SAN triage agent. Prefer evidence over guesses.')
    .tool(fcnsLive)
    .tool(fcnsHistory)
    .tool(sendEmail)
    .recorder(choices)
    .build();

  await agent.run({ message: 'did wwpn 21:00:00:24:ff:4a:12:03 drop off the fabric recently?' });
  const embedderCallsDuringRun = counter.calls();

  const out: string[] = [];
  out.push('═══ TOOL-CHOICE MARGINS — one ambiguous question, twin tools ═══', '');
  out.push(
    `lazy-embed proof: embedder calls during agent.run() = ${embedderCallsDuringRun}`,
    '(scoring happens NOW, on first read:)',
    '',
  );

  const calls = await choices.getCalls(); // ← embeddings happen here
  for (const call of calls) {
    out.push(`■ ${call.runtimeStageId}  (iteration ${call.iteration})`);
    out.push(
      `  context: ${call.contextText.split('\n')[0]}${call.contextText.includes('\n') ? ' …' : ''}`,
    );
    out.push(`  offered: ${call.offered.map((t) => t.name).join(', ')}`);
    if (call.margin) {
      for (const s of call.margin.scores) {
        const tags = [
          call.chosen.includes(s.name) ? 'CHOSEN' : '',
          call.margin.topScored === s.name ? 'top-scored' : '',
        ]
          .filter(Boolean)
          .join(' · ');
        out.push(`    ${s.score.toFixed(4)}  ${s.name}${tags ? `  ← ${tags}` : ''}`);
      }
      out.push(
        `  margin: ${call.margin.margin?.toFixed(4) ?? 'n/a'}` +
          `${call.margin.flags.narrow ? '  ⚠ NARROW' : ''}` +
          `${call.margin.flags.proxyDisagreement ? '  ⚠ PROXY-DISAGREEMENT' : ''}`,
      );
    } else {
      out.push(`  margin: — (${call.skipped ?? 'pending'})`);
    }
    out.push('');
  }

  const flagged = await choices.getFlagged();
  const summary = await choices.getSummary();
  out.push('═══ FLAGGED (narrow OR proxy-disagreement) ═══');
  out.push(
    flagged.length === 0
      ? '  none — every scored choice was decisive under the proxy'
      : flagged
          .map(
            (call) =>
              `  ${call.runtimeStageId}: chose ${call.chosen.join('+')}, ` +
              `margin ${call.margin?.margin?.toFixed(4) ?? 'n/a'}` +
              `${
                call.margin?.flags.proxyDisagreement
                  ? `, proxy preferred ${call.margin.topScored}`
                  : ''
              }`,
          )
          .join('\n'),
  );
  out.push(
    '',
    '═══ RUN SUMMARY (C6) ═══',
    `  llmCallsWithTools=${summary.llmCallsWithTools} choices=${summary.choices} scored=${summary.scored}`,
    `  flagged=${summary.flagged} narrow=${summary.narrow} proxyDisagreement=${summary.proxyDisagreement} skipped=${summary.skipped}`,
    '',
    `embedder calls after reads: ${counter.calls()} (scores memoize — re-reads stay free)`,
    '',
    'Honest claim: margins are embedding geometry between context and tool',
    'descriptions — evidence of decisiveness, never "the model chose because".',
  );

  const transcript = out.join('\n');
  console.log(transcript);
  return { calls, flagged, summary, embedderCallsDuringRun, transcript };
}

if (isCliEntry(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
