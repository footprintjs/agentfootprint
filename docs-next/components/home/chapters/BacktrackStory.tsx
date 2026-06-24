'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Chapter 1 — "The problem". An agent approved a refund it shouldn't; asking a model
 * gives unfalsifiable guesses; so we REWIND the recorded ReAct loop — SCROLL-DRIVEN
 * and PINNED: as you scroll the flowchart stays put and the backward path is traced
 * one hop at a time, each hop drawing BACKWARD (downstream→upstream) with a reversed
 * arrowhead + a traveling rewind pulse, then the node lights:
 * Final ← Route ← CallLLM ← messageAPI ← System Prompt (suspect) → revealed at step 4
 * (the loop carried it untouched to step 14) → ablation flips the outcome to denied.
 * CAUSAL. Why is a query, not a guess.
 */

type Node = { n: string; nt: string; ns?: string; x: number; y: number; cls?: string };
const NODES: Node[] = [
  { n: 'ctx', nt: 'Context', ns: 'ReAct loop', x: 50, y: 9 },
  { n: 'sys', nt: 'System Prompt', x: 18, y: 26, cls: 'slot' },
  { n: 'msg', nt: 'Messages', x: 50, y: 26, cls: 'slot' },
  { n: 'tool', nt: 'Tools', x: 82, y: 26, cls: 'slot' },
  { n: 'api', nt: 'messageAPI', ns: 'assemble', x: 50, y: 46 },
  { n: 'llm', nt: 'CallLLM', ns: 'send request', x: 50, y: 64 },
  { n: 'route', nt: 'Route', x: 50, y: 83, cls: 'diamond' },
  { n: 'final', nt: '→ approved ✗', x: 21, y: 96, cls: 'end' },
  { n: 'tc', nt: 'ToolCalls', ns: '↻ loop again', x: 79, y: 96 },
];

// viewBox 0 0 100 100 over a square flow. Edges run node-center → node-center; the opaque
// node boxes overlay the ends, so each line meets the box cleanly. Route's 45° branches
// leave the diamond's bottom point and elbow to the spread-out approved/ToolCalls boxes.
const EDGES: { e: string; d: string; loop?: boolean }[] = [
  { e: 'ctx-sys', d: 'M50,9 L20.2,9 Q18,9 18,13 L18,26' },
  { e: 'ctx-msg', d: 'M50,9 L50,26' },
  { e: 'ctx-tool', d: 'M50,9 L79.8,9 Q82,9 82,13 L82,26' },
  { e: 'sys-api', d: 'M18,26 L18,42 Q18,46 20.2,46 L50,46' },
  { e: 'msg-api', d: 'M50,26 L50,46' },
  { e: 'api-llm', d: 'M50,46 L50,64' },
  { e: 'tool-llm', d: 'M82,26 L82,60 Q82,64 79.8,64 L50,64' },
  { e: 'llm-route', d: 'M50,64 L50,83' },
  { e: 'route-final', d: 'M50,90 L44,96 L21,96' },
  { e: 'route-tc', d: 'M50,90 L56,96 L79,96' },
  { e: 'loop', d: 'M79,96 L96,96 L96,5 L50,5 L50,9', loop: true },
];

const LIT_EDGES: string[][] = [
  [],
  ['route-final'],
  ['route-final', 'llm-route'],
  ['route-final', 'llm-route', 'api-llm'],
  ['route-final', 'llm-route', 'api-llm', 'sys-api'],
  ['route-final', 'llm-route', 'api-llm', 'sys-api', 'ctx-sys'],
  ['route-final', 'llm-route', 'api-llm', 'sys-api', 'ctx-sys'],
];
// NB: the ReAct loop edge is deliberately NOT lit — it's iteration control-flow, NOT on the
// backward causal slice of the final decision (step 14 EXITED the loop to Final). The value's
// persistence across iterations 4→14 is shown by the replay scrubber, not by lighting the loop.
// the ONE edge newly traced at each phase — gets the backward draw-in + the traveling rewind pulse.
const HEAD_EDGE: (string | null)[] = [null, 'route-final', 'llm-route', 'api-llm', 'sys-api', 'ctx-sys', null];
const LIT_NODES: string[][] = [
  [],
  ['route'],
  ['route', 'llm'],
  ['route', 'llm', 'api'],
  ['route', 'llm', 'api'],
  ['route', 'llm', 'api', 'ctx'],
  ['route', 'llm', 'api', 'ctx'],
];
// backward arrowhead per hop: a mid-edge point (viewBox units) + rotation pointing toward the UPSTREAM node.
const HOP_ARROWS: Record<string, { x: number; y: number; a: number }> = {
  'route-final': { x: 33, y: 96, a: 0 },
  'llm-route': { x: 50, y: 74, a: -90 },
  'api-llm': { x: 50, y: 55, a: -90 },
  'sys-api': { x: 34, y: 46, a: 180 },
  'ctx-sys': { x: 18, y: 18, a: -90 },
};
const EDGE_D: Record<string, string> = Object.fromEntries(EDGES.map((e) => [e.e, e.d]));
const CAPS = [
  <>The run ended wrong — at <b>step 14.</b> Every step was recorded as this loop. <b>Scroll to rewind it.</b></>,
  <>Retrace the decision: <b>Final ← Route.</b> Which branch fired, and why.</>,
  <><b>← CallLLM.</b> The model’s pick — replay the exact request that produced it.</>,
  <><b>← messageAPI.</b> The step that assembled that request from the context slots.</>,
  <><b>← System Prompt.</b> messageAPI pulled from this slot — the suspect. But <i>when</i> did it get there?</>,
  <><b>Step 4:</b> a search pulled in the wrong document and put it in the <b>System Prompt.</b> Nothing removed it — so it was still there at <b>step 14.</b></>,
  <>Remove it, re-run from step 4 → <b>denied.</b> <span className="stamp">● CAUSAL</span> — proven by replay, not guessed.</>,
];
const LAST = 6;
const headStep = (p: number) => (p <= 2 ? 14 : p <= 4 ? 9 : 4);

export function BacktrackStory() {
  const [phase, setPhase] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  // scroll-driven scrubbing: the pinned stage advances phase by scroll progress
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const track = trackRef.current;
        if (!track) return;
        const rect = track.getBoundingClientRect();
        const total = rect.height - window.innerHeight;
        const p = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
        setPhase(Math.min(LAST, Math.floor(p * (LAST + 1))));
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // prev/next replay controls: scroll the window to the target phase's scroll offset
  const goToPhase = (k: number) => {
    const track = trackRef.current;
    if (!track) return;
    const target = Math.max(0, Math.min(LAST, k));
    const total = track.offsetHeight - window.innerHeight;
    const trackTop = track.getBoundingClientRect().top + window.scrollY;
    const p = (target + 0.5) / (LAST + 1);
    window.scrollTo({ top: trackTop + p * total, behavior: 'smooth' });
  };

  const litE = new Set(LIT_EDGES[phase]);
  const litN = new Set(LIT_NODES[phase]);
  const headEdge = HEAD_EDGE[phase];
  const step = headStep(phase);
  const headLeft = ((step - 0.5) / 14) * 100;

  return (
    <div className="af-bt">
      <p className="af-bt-head">It approved a refund it should have denied.</p>
      <p className="af-bt-sub">
        Somewhere in the context you fed it, something flipped the decision. Which one?
      </p>

      <div className="af-bt-grid">
        <div className="af-bt-card">
          <h4>The run</h4>
          <p style={{ fontFamily: 'var(--fd-font-mono, monospace)', fontSize: 12.5, marginTop: 8 }}>
            classify → refund &nbsp;·&nbsp; check → continue &nbsp;·&nbsp;{' '}
            <span style={{ color: 'var(--coral, #c2542a)' }}>decide → approved ✗</span>
          </p>
        </div>
        <div className="af-bt-card">
          <h4>Can&apos;t you just ask a model?</h4>
          <div className="af-bt-guess"><span className="who">gpt</span><span>the customer history</span><span className="conf">98%</span></div>
          <div className="af-bt-guess"><span className="who">claude</span><span>the policy doc</span><span className="conf">95%</span></div>
          <div className="af-bt-guess"><span className="who">llama</span><span>the tone rule</span><span className="conf">91%</span></div>
          <p style={{ marginTop: 8 }}>Three confident answers, none falsifiable.</p>
        </div>
      </div>

      {/* scroll-pinned rewind: flowchart on the left, scroll-driven commentary on the right */}
      <div className="af-pin-track" ref={trackRef}>
        <div className="af-pin-stage af-flowwrap">
          <div className="af-bt-row">
            <div className="af-bt-left">
              <div className="af-flow">
                <svg className="edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {EDGES.map((ed) => (
                    <path
                      key={ed.e}
                      d={ed.d}
                      pathLength={1}
                      className={`fe${ed.loop ? ' loop' : ''}${litE.has(ed.e) ? ' lit' : ''}`}
                    />
                  ))}
                  {/* backward arrowheads — persist for every traced hop; the active one pops in */}
                  {[...litE]
                    .filter((e) => HOP_ARROWS[e])
                    .map((e) => {
                      const a = HOP_ARROWS[e];
                      return (
                        <path
                          key={`ah-${e}`}
                          className={`fe-arrow${e === headEdge ? ' head' : ''}`}
                          d="M-1.7,-1.5 L1.9,0 L-1.7,1.5 Z"
                          transform={`translate(${a.x} ${a.y}) rotate(${a.a})`}
                        />
                      );
                    })}
                  {/* traveling rewind pulse on the hop being traced (remounts per phase to replay it) */}
                  {headEdge && (
                    <path key={`pulse-${phase}-${headEdge}`} className="fe-pulse" d={EDGE_D[headEdge]} pathLength={1} />
                  )}
                </svg>
                {NODES.map((nd) => {
                  const suspect = nd.n === 'sys' && phase === 4;
                  const culprit = nd.n === 'sys' && phase >= 5;
                  const ablated = nd.n === 'sys' && phase >= 6;
                  const denied = nd.n === 'final' && phase >= 6;
                  const cls = [
                    'fnode',
                    nd.cls || '',
                    litN.has(nd.n) ? 'lit' : '',
                    suspect ? 'suspect' : '',
                    culprit ? 'culprit' : '',
                    ablated ? 'ablated' : '',
                    denied ? 'denied' : '',
                  ].join(' ');
                  // the System Prompt slot tags its bad content once it's the culprit; ablation
                  // strikes the DOC (this sub-label), NOT the slot name — you remove the retrieved
                  // doc, not the system prompt.
                  const subLabel = nd.n === 'sys' && culprit ? 'wrong doc' : nd.ns;
                  return (
                    <div key={nd.n} className={cls} style={{ left: `${nd.x}%`, top: `${nd.y}%` }}>
                      <span className="nt">{denied ? '→ denied ✓' : nd.nt}</span>
                      {subLabel && <span className="ns">{subLabel}</span>}
                    </div>
                  );
                })}
              </div>

              {/* fixed-width replay scrubber: prev/next + the 14-step timeline with a playhead */}
              <div className="af-replay">
                <div className="af-replay-ctrls">
                  <button
                    type="button"
                    className="af-replay-btn"
                    onClick={() => goToPhase(phase - 1)}
                    disabled={phase === 0}
                    aria-label="Previous step"
                  >
                    ◂
                  </button>
                  <span className="af-replay-label">
                    <span className="rw">↩ rewinding</span> step <b>{step}</b> <span className="of">/ 14</span>
                  </span>
                  <button
                    type="button"
                    className="af-replay-btn"
                    onClick={() => goToPhase(phase + 1)}
                    disabled={phase === LAST}
                    aria-label="Next step"
                  >
                    ▸
                  </button>
                </div>
                <div className="af-replay-track">
                  {Array.from({ length: 14 }, (_, i) => {
                    const s = i + 1;
                    const on = s >= step;
                    const cul = s === 4 && phase >= 5;
                    return <span key={i} className={`af-replay-seg${on ? ' on' : ''}${cul ? ' cul' : ''}`} />;
                  })}
                  <span className="af-replay-head" style={{ left: `${headLeft}%` }} />
                </div>
              </div>
            </div>

            <aside className="af-flow-aside">
              <span className="af-aside-prog" aria-hidden="true">
                <span className="af-aside-fill" style={{ height: `${(phase / LAST) * 100}%` }} />
              </span>
              <p className="af-flow-kicker">So how do you actually know?</p>
              <p className="af-flow-head">
                Rewind the run — <em>backward.</em>
              </p>
              <p className="af-tl-cap">{CAPS[phase]}</p>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
