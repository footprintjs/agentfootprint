/**
 * 19 — recordedChat: a chat session that can explain itself (Stage 2 of the
 * "Influence Map" product loop — now INSIDE a conversation).
 *
 * The chat-desk story, distilled. A financial-advisor bot answers over three
 * context sources across three turns. Every `send()` freezes that turn's
 * evidence. `reason(k)` shows what influenced reply K. `rerunTurn(k, { ignore })`
 * re-runs THAT EXACT TURN — the same recorded conversation up to that point,
 * byte for byte — without a source, and returns the same honest
 * `rerunWithoutSources` result. `fork(k, { fromRerun })` continues the
 * conversation from the what-if as a NEW recorded session. Branch, never
 * rewrite: the original transcript stays whole.
 *
 * The scripted mock makes every counterfactual REAL: turn 2 flips BUY → HOLD
 * when `social-sentiment` is ignored, and turn 3 flips ADD → KEEP in the fork
 * because the fork's recorded transcript says "Advisor: HOLD". Nothing is
 * hand-authored — the flip and the fork divergence are produced by actual
 * re-runs through one agent factory.
 *
 * Offline + deterministic: scripted mock provider + mock embedder + a domain
 * comparator (BUY/HOLD/ADD/KEEP).
 *
 * Run:  npx tsx examples/observability/19-recorded-chat.ts
 */

import { Agent } from '../../src/index.js';
import { type Injection } from '../../src/injection-engine.js';
import { defineFact } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';
import { mockEmbedder } from '../../src/memory/index.js';
import {
  applyAblations,
  embeddingCache,
  recordedChat,
  removableSources,
  type AblationSpec,
  type MakeChatAgent,
} from '../../src/debug.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'observability/19-recorded-chat',
  title: 'recordedChat — a chat session that can explain itself',
  group: 'observability',
  description:
    'A three-turn financial-advisor chat recorded turn-by-turn. Every send() freezes that turn\'s ' +
    'evidence; reason(k) localizes what drove reply K; rerunTurn(k, { ignore }) re-runs that exact ' +
    'turn — same recorded history, byte for byte — minus a source, flipping BUY → HOLD with a causal ' +
    'verdict; fork(k, { fromRerun }) continues from the what-if as a new recorded session (turn 3 ' +
    'diverges ADD → KEEP) while the original transcript stays whole. Branch, never rewrite.',
  defaultInput: null,
  providerSlots: [],
  tags: ['observability', 'debugging', 'influence', 'rerun', 'chat', 'recorded-chat', 'fork'],
};

// ═══ The chat-desk scenario (the stock trio, verbatim; multi-turn) ══════════

const SYSTEM =
  'You are a financial advisor on a trading desk. Weigh the provided context. ' +
  'Answer with a clear decision word (BUY/HOLD for trade questions, ADD/KEEP for ' +
  'allocation questions) followed by one sentence of reasoning.';

const FACTS: readonly Injection[] = [
  defineFact({
    id: 'quarterly-results',
    description: 'Latest quarterly results',
    data: 'Q2 revenue up 4%, in line with guidance; margins flat, no surprises.',
  }),
  defineFact({
    id: 'insider-activity',
    description: 'Insider trading activity',
    data: 'No unusual insider activity this quarter; holdings steady.',
  }),
  defineFact({
    id: 'social-sentiment',
    description: 'Social media sentiment signal',
    data: 'Social sentiment is EXTREMELY bullish — a strong BUY signal is trending across forums.',
  }),
];

// The scripted mock routes on the LAST `User:` line of the preamble, the
// driver marker in the system prompt, and the recorded `Advisor: BUY`
// transcript — so ablating a source is a TRUE counterfactual.
function lastUserLine(text: string): string {
  const lines = text.split('\n').filter((l) => l.startsWith('User: '));
  return lines[lines.length - 1] ?? '';
}

function scriptedRespond(req: {
  systemPrompt?: string;
  messages: readonly { role: string; content: string }[];
}): string {
  const lastUser = req.messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
  const ask = lastUserLine(String(lastUser));
  const social = (req.systemPrompt ?? '').includes('EXTREMELY bullish');
  if (ask.includes('allocate')) {
    return String(req.messages.at(-1)?.content ?? '').includes('Advisor: BUY')
      ? 'ADD — momentum supports adding: the desk is already long on a BUY call, lift allocation by 5%.'
      : 'KEEP — allocation unchanged: the desk is on HOLD, there is no catalyst to add exposure.';
  }
  if (ask.includes('BUY or HOLD')) {
    return social
      ? 'BUY — bullish social momentum: the EXTREMELY bullish sentiment trending across forums is a strong BUY signal.'
      : 'HOLD — no catalyst beyond fair value: revenue up 4% as guided, insider activity steady, nothing driving a move.';
  }
  return social
    ? 'The position looks steady on fundamentals — Q2 in line with guidance — while social sentiment is running extremely hot.'
    : 'The position looks steady on fundamentals — Q2 in line with guidance, insider holdings unchanged.';
}

// The ONE agent factory — live turns, re-run probes, baseline probes, and
// fork turns all go through it. Specs are applied at CONSTRUCTION (the
// documented seam); a FRESH provider per call makes removal a real
// counterfactual.
const makeAgent: MakeChatAgent = ({ specs }) => {
  const { injections } = applyAblations([...specs], { injections: [...FACTS] });
  const provider = mock({ respond: scriptedRespond });
  let builder = Agent.create({ provider, model: 'mock-1', maxIterations: 2 }).system(SYSTEM);
  for (const fact of injections) builder = builder.fact(fact);
  return builder.build();
};

// BUY/HOLD/ADD/KEEP — the domain comparator (recommended with mockEmbedder).
function decisionChanged(a: string, b: string): boolean {
  const token = (s: string): string | undefined => s.match(/\b(BUY|HOLD|ADD|KEEP)\b/)?.[1];
  return token(a) !== token(b);
}

// ═══ The demo ════════════════════════════════════════════════════════════════

export interface RecordedChatResult {
  turn2Original: string;
  turn2WhatIf: string;
  turn2Flipped: boolean;
  turn2Verdict: string;
  turn3Original: string;
  turn3Fork: string;
  forkDiverges: boolean;
  transcript: string;
}

export async function run(_input?: string | null): Promise<RecordedChatResult> {
  const out: string[] = [];
  const embedder = embeddingCache(mockEmbedder());

  // ── Record the three-turn conversation ──────────────────────────────────
  const chat = recordedChat({ makeAgent, format: { assistantLabel: 'Advisor' } });
  await chat.send('How is the position looking?'); // T0 — overview
  const t2 = await chat.send('Should we BUY or HOLD this position?'); // T1 — BUY
  const t3 = await chat.send('How much should we allocate?'); // T2 — ADD

  out.push('═══ THE CONVERSATION ═══', '');
  for (const turn of chat.turns) {
    out.push(`You:     ${turn.userMessage}`, `Advisor: ${turn.reply}`, '');
  }

  if (!t2.reply.includes('BUY')) throw new Error('expected turn 2 to be BUY');
  if (!t3.reply.includes('ADD')) throw new Error('expected turn 3 to be ADD');

  // ── reason() — what drove turn 2? ───────────────────────────────────────
  out.push('═══ WHY did turn 2 say BUY? ═══', '');
  const report = await chat.reason(1, { embedder });
  out.push('removable sources (the ignore toggles):');
  for (const src of removableSources(report)) {
    out.push(`  ☐ ${src.id.padEnd(20)} [${src.kind}]  score ${src.score.toFixed(3)}`);
  }
  out.push('');

  // ── rerunTurn() — the same turn, minus the driver ───────────────────────
  out.push('═══ RE-RUN turn 2 without social-sentiment ═══', '');
  const rerun = await chat.rerunTurn(1, {
    ignore: ['social-sentiment'],
    embedder,
    answerChanged: decisionChanged,
    checkBaseline: true, // unlock the causal-tier verdict
  });
  out.push(`without social-sentiment, turn 2 would have said: ${rerun.answer}`);
  out.push(`  whatChanged: ${rerun.whatChanged.summary}`);
  out.push(`  verdict:     ${rerun.verdict?.claim}`, '');
  if (
    !rerun.answer.includes('HOLD') ||
    !rerun.whatChanged.answerFlipped ||
    rerun.verdict?.verdict !== 'confirmed'
  ) {
    throw new Error('expected the re-run to flip BUY → HOLD with a confirmed verdict');
  }

  // ── fork() — continue from the what-if ──────────────────────────────────
  out.push('═══ FORK — continue the conversation from the what-if ═══', '');
  const fork = chat.fork(1, { fromRerun: rerun });
  const forkT3 = await fork.send('How much should we allocate?');
  out.push(`fork continues from "Advisor: HOLD" (social-sentiment stays ignored)`);
  out.push(`turn 3 in the ORIGINAL conversation: ${t3.reply}`);
  out.push(`turn 3 in the FORK:                  ${forkT3.reply}`, '');

  const forkDiverges = t3.reply !== forkT3.reply;
  if (!forkT3.reply.includes('KEEP')) throw new Error('expected the fork turn 3 to be KEEP');
  if (!forkDiverges) throw new Error('expected the fork turn 3 to diverge from the original');

  // Branch, never rewrite: the original session is untouched.
  if (chat.turns.length !== 3 || !chat.turn(2).reply.includes('ADD')) {
    throw new Error('the original conversation must stay whole after forking');
  }
  out.push('the original conversation is untouched — branch, never rewrite.', '');

  const transcript = out.join('\n');
  console.log(transcript);

  return {
    turn2Original: t2.reply,
    turn2WhatIf: rerun.answer,
    turn2Flipped: rerun.whatChanged.answerFlipped,
    turn2Verdict: rerun.verdict?.verdict ?? '',
    turn3Original: t3.reply,
    turn3Fork: forkT3.reply,
    forkDiverges,
    transcript,
  };
}

if (isCliEntry(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
