'use client';

import { revealer } from '@/lib/features/useAdditiveSteps';
import { CodeCard, Ln, Caret, K, S } from '../CodeCard';

/**
 * 01 BUILD — the agent types itself into existence, one line per scroll step.
 *
 * REAL API (hand-verified against src/ — these are display strings, so this list IS the guard):
 *   import { Agent }     → src/index.ts (public entry); quick-start.mdx uses the same import
 *   import { anthropic } from 'agentfootprint/llm-providers'
 *                        → package.json exports "./llm-providers" (package.json:136)
 *   Agent.create(opts)   → src/core/Agent.ts:469  `static create(opts: AgentOptions): AgentBuilder`
 *   { provider, model }  → src/core/agent/types.ts:48 `readonly provider: LLMProvider` (required)
 *                                                 :53 `readonly model: string`         (required)
 *   anthropic({ defaultModel }) → src/adapters/llm/AnthropicProvider.ts:170; the id below is the
 *                        factory's own default, AnthropicProvider.ts:172, and the exact string in
 *                        its JSDoc example (AnthropicProvider.ts:163-165)
 *   .system(prompt)      → src/core/agent/AgentBuilder.ts:178
 *   .tool(tool)          → src/core/agent/AgentBuilder.ts:186
 *   .build()             → src/core/agent/AgentBuilder.ts:838
 *   .run({ message })    → AgentInput; same call shape as content/docs/getting-started/quick-start.mdx
 *
 * There is NO `.model(provider)` builder method — the provider is constructor options, not a
 * chained call. (The mockup showed `.model(anthropic(...))`; it does not exist.)
 */
export function BuildStage({ step }: { step: number }) {
  const on = revealer(step);
  // the caret rides the most recently arrived line — the "still typing" tell
  const caret = (layer: number) => step === layer;

  return (
    <div className="aff-stage-pad">
      <CodeCard className={step >= 7 ? 'is-built' : ''}>
        <Ln className={`${on(1)} dim`}>
          <K>import</K> {'{ anthropic } '}
          <K>from</K> <S>&apos;agentfootprint/llm-providers&apos;</S>
        </Ln>
        <Ln className={on(2)}>
          <K>const</K> scout = Agent.create({'{'}
          {caret(2) && <Caret />}
        </Ln>
        <Ln i={1} className={on(3)}>
          provider: anthropic({'{'} defaultModel: <S>&apos;claude-sonnet-4-5-20250929&apos;</S> {'}'}),
          {caret(3) && <Caret />}
        </Ln>
        <Ln i={1} className={on(4)}>
          model: <S>&apos;anthropic&apos;</S>,
        </Ln>
        <Ln className={on(4)}>
          {'})'}
          {caret(4) && <Caret />}
        </Ln>
        <Ln i={1} className={on(5)}>
          .system(<S>&apos;cite every claim&apos;</S>)
          {caret(5) && <Caret />}
        </Ln>
        <Ln i={1} className={on(6)}>
          .tool(webSearch)
        </Ln>
        <Ln i={1} className={on(6)}>
          .tool(readPdf)
          {caret(6) && <Caret />}
        </Ln>
        <Ln i={1} className={`${on(7)} hl`}>
          .build()
        </Ln>
        <Ln className={`${on(7)} dim`}>
          <K>await</K> scout.run({'{'} message: <S>&apos;summarise q3-brief.pdf&apos;</S> {'}'})
          {caret(7) && <Caret />}
        </Ln>
      </CodeCard>
    </div>
  );
}
