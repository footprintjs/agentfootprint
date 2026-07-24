/**
 * chat-desk fixture — the visible-reasoning example-7 stock desk, verbatim,
 * as a `recordedChat` factory. A financial-advisor bot answers over three
 * context sources; the scripted mock routes on the LAST `User:` line of the
 * preamble, the driver marker in the system prompt, and the recorded
 * `Advisor: BUY` transcript — so every counterfactual is REAL (turn 2 flips
 * BUY↔HOLD when `social-sentiment` is ablated; turn 3 flips ADD↔KEEP by what
 * the recorded transcript says). Nothing is hand-authored; the flips are
 * produced by actual re-runs through the one factory.
 *
 * Everything is $0: mock provider + mock embedder + a domain comparator.
 */
import { Agent } from '../../../src/core/Agent';
import { defineFact } from '../../../src/lib/injection-engine/factories/defineFact';
import type { Injection } from '../../../src/lib/injection-engine/types';
import { mock } from '../../../src/adapters/llm/MockProvider';
import type { LLMRequest } from '../../../src/adapters/types';
import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import { embeddingCache, type Embedder } from '../../../src/lib/influence-core';
import { applyAblations, type AblationSpec } from '../../../src/lib/context-bisect';
import type { ChatFormat, MakeChatAgent } from '../../../src/lib/recorded-chat';

export const SYSTEM =
  'You are a financial advisor on a trading desk. Weigh the provided context. ' +
  'Answer with a clear decision word (BUY/HOLD for trade questions, ADD/KEEP for ' +
  'allocation questions) followed by one sentence of reasoning.';

export const FACTS: readonly Injection[] = [
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

// The exact scripted replies (from visible-reasoning/07-chat-desk).
export const REPLY = {
  buy: 'BUY — bullish social momentum: the EXTREMELY bullish sentiment trending across forums is a strong BUY signal.',
  hold: 'HOLD — no catalyst beyond fair value: revenue up 4% as guided, insider activity steady, nothing driving a move.',
  add: 'ADD — momentum supports adding: the desk is already long on a BUY call, lift allocation by 5%.',
  keep: 'KEEP — allocation unchanged: the desk is on HOLD, there is no catalyst to add exposure.',
  overviewSocial:
    'The position looks steady on fundamentals — Q2 in line with guidance — while social sentiment is running extremely hot.',
  overviewPlain:
    'The position looks steady on fundamentals — Q2 in line with guidance, insider holdings unchanged.',
} as const;

/** The last `User:` line of the preamble (earlier questions live in it too). */
function lastUserLine(req: LLMRequest): string {
  const text = req.messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
  const lines = String(text)
    .split('\n')
    .filter((l) => l.startsWith('User: '));
  return lines[lines.length - 1] ?? '';
}

export function scriptedRespond(req: LLMRequest): string {
  const ask = lastUserLine(req);
  const social = (req.systemPrompt ?? '').includes('EXTREMELY bullish');
  if (ask.includes('allocate')) {
    // turn 3 — depends on the RECORDED transcript the message carries.
    return String(req.messages.at(-1)?.content ?? '').includes('Advisor: BUY')
      ? REPLY.add
      : REPLY.keep;
  }
  if (ask.includes('BUY or HOLD')) {
    // turn 2 — the driver fact decides.
    return social ? REPLY.buy : REPLY.hold;
  }
  // turn 1 — overview.
  return social ? REPLY.overviewSocial : REPLY.overviewPlain;
}

/** The chat format — `Advisor:` labels keep the mock's transcript routing intact. */
export const chatDeskFormat: ChatFormat = { assistantLabel: 'Advisor' };

/** BUY/HOLD/ADD/KEEP — the domain comparator (real flips under mockEmbedder). */
export function decisionChanged(a: string, b: string): boolean {
  const token = (s: string): string | undefined => s.match(/\b(BUY|HOLD|ADD|KEEP)\b/)?.[1];
  const ta = token(a);
  const tb = token(b);
  // Both carry a decision token here, so a direct compare is honest.
  return ta !== tb;
}

export interface ChatDeskFixture {
  readonly makeAgent: MakeChatAgent;
  readonly format: ChatFormat;
  readonly embedder: Embedder;
  readonly decisionChanged: (a: string, b: string) => boolean;
}

/**
 * Build a chat-desk fixture. `onRequest` (optional) observes every
 * `LLMRequest` the provider sees — the byte-exact-history trap test uses it.
 */
export function chatDeskFixture(hooks?: {
  readonly onRequest?: (req: LLMRequest) => void;
}): ChatDeskFixture {
  const makeAgent: MakeChatAgent = ({ specs }) => {
    const { injections } = applyAblations([...specs], { injections: [...FACTS] });
    const provider = mock({
      respond: (req) => {
        hooks?.onRequest?.(req);
        return scriptedRespond(req);
      },
    });
    let builder = Agent.create({ provider, model: 'mock-1', maxIterations: 2 }).system(SYSTEM);
    for (const fact of injections) builder = builder.fact(fact);
    return builder.build();
  };

  return {
    makeAgent,
    format: chatDeskFormat,
    embedder: embeddingCache(mockEmbedder()),
    decisionChanged,
  };
}

export type { AblationSpec };
