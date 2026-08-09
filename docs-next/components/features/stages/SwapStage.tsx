'use client';

import { useState } from 'react';
import { revealer } from '@/lib/features/useAdditiveSteps';
import { CodeCard, Ln, Caret, K, S } from '../CodeCard';

/**
 * 04 SWAP — real tabs. Clicking one retypes ONLY the provider expression; every other line of
 * the panel stays exactly where it is. The outgoing provider ghosts out above (struck through)
 * as the incoming one types in — the whole point of the beat rendered as a diff.
 *
 * REAL API (hand-verified; display strings, so this list IS the guard):
 *   anthropic({ defaultModel }) → src/adapters/llm/AnthropicProvider.ts:170 · JSDoc example
 *                                 :163-165 pairs it with `model: 'anthropic'`
 *   openai({ defaultModel })    → src/adapters/llm/OpenAIProvider.ts:166 · JSDoc example
 *                                 :159-161 pairs `openai({ defaultModel: 'gpt-4o' })` with
 *                                 `model: 'openai'`
 *   ollama({ defaultModel })    → src/adapters/llm/OpenAIProvider.ts:427 · JSDoc example :424
 *                                 uses `ollama({ defaultModel: 'llama3.2' })`; the returned
 *                                 provider's `name` is 'ollama' (:437)
 *   all three ship from the "./providers" subpath
 *
 * The provider is CONSTRUCTOR OPTIONS (`Agent.create({ provider, model })`, src/core/Agent.ts:469
 * + src/core/agent/types.ts:48/53) — there is no `.model()` builder method to chain.
 */

type Vendor = { key: string; tab: string; fn: string; defaultModel: string; model: string };

const VENDORS: readonly Vendor[] = [
  { key: 'claude', tab: 'Claude', fn: 'anthropic', defaultModel: 'claude-sonnet-4-5-20250929', model: 'anthropic' },
  { key: 'gpt', tab: 'GPT', fn: 'openai', defaultModel: 'gpt-4o', model: 'openai' },
  { key: 'ollama', tab: 'Ollama (local)', fn: 'ollama', defaultModel: 'llama3.2', model: 'ollama' },
];

/** `provider: fn({ defaultModel: '…' }),` — the one line that changes. */
function providerText(v: Vendor) {
  return `provider: ${v.fn}({ defaultModel: '${v.defaultModel}' }),`;
}

export function SwapStage({ step }: { step: number }) {
  const on = revealer(step);
  const [active, setActive] = useState(0);
  // the provider we just left — rendered struck-through above the new one, then it fades itself
  // out via a forwards CSS animation (no timers to leak, and reduced-motion lands on 'gone').
  const [prev, setPrev] = useState<number | null>(null);
  const v = VENDORS[active];

  const pick = (i: number) => {
    if (i === active) return;
    setPrev(active);
    setActive(i);
  };

  return (
    <div className="aff-swap">
      <div className={`aff-tabs-row ${on(1)}`}>
        <div className="aff-tabs" role="tablist" aria-label="LLM provider">
          {VENDORS.map((vendor, i) => (
            <button
              key={vendor.key}
              type="button"
              role="tab"
              id={`aff-swap-tab-${vendor.key}`}
              aria-selected={i === active}
              aria-controls="aff-swap-panel"
              className={`aff-tab${i === active ? ' on' : ''}`}
              onClick={() => pick(i)}
            >
              {vendor.tab}
            </button>
          ))}
        </div>
      </div>

      <CodeCard className={`aff-swap-code ${on(2)}`}>
        <div id="aff-swap-panel" role="tabpanel" aria-labelledby={`aff-swap-tab-${v.key}`}>
          <Ln className="dim">
            <K>import</K> {`{ ${v.fn} } `}
            <K>from</K> <S>&apos;agentfootprint/providers&apos;</S>
          </Ln>
          <Ln>
            <K>const</K> scout = Agent.create({'{'}
          </Ln>

          {/* the morph zone — highlighted, gold left rule; the rest of the panel never moves */}
          <div className={`aff-morph ${on(3)}`}>
            {prev !== null && (
              <div className="aff-ghost" key={`${prev}-${active}`} aria-hidden="true">
                {'  '}
                {providerText(VENDORS[prev])}
              </div>
            )}
            <Ln i={1} className="aff-swap-live" key={v.key}>
              provider: {v.fn}({'{'} defaultModel: <S>&apos;{v.defaultModel}&apos;</S> {'}'}),
              <Caret />
            </Ln>
            <Ln i={1}>
              model: <S>&apos;{v.model}&apos;</S>,
            </Ln>
          </div>

          <Ln>{'})'}</Ln>
          <Ln i={1}>
            .system(<S>&apos;cite every claim&apos;</S>)
          </Ln>
          <Ln i={1}>.tool(webSearch)</Ln>
          <Ln i={1}>.build()</Ln>
        </div>
      </CodeCard>
    </div>
  );
}
