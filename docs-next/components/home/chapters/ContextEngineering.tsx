'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Chapter 2 — "Context engineering, abstracted." (ported from the context-engineering design).
 *
 * Four beats inside the chapter:
 *  (a) ABSTRACTION diagram — flavors stream into the 3 LLM slots (system/messages/tools),
 *      auto-animated once scrolled into view (IntersectionObserver).
 *  (b) TRIGGERS table — always / rule / on-tool-return / llm-activated.
 *  (c) CODE panel — the support-agent.ts snippet with span-based syntax highlighting.
 *  (d) DYNAMIC REACT stepper — 3 iterations, auto-cycling AND clickable iter buttons,
 *      with the Classic-vs-Dynamic compare cards.
 *
 * The standalone page chrome (top nav, footer, theme toggle) is dropped — this renders
 * embedded inside a chapter shell that already supplies the site + chapter headers.
 * prefers-reduced-motion: timers are skipped and the final state is shown directly.
 */

// ---------- (a) Abstraction diagram ----------
type FlavorColor = 'teal' | 'purple' | 'amber' | 'coral' | 'slate';
type SlotRef = { slot: number; strong: boolean };
type FlavorMapEntry = { name: string; color: FlavorColor; slots: SlotRef[]; blurb: ReactNode };
// GROUND-TRUTH flavor→slot mapping, read from the injection-engine factories (NOT guessed):
//   defineSteering  → { systemPrompt }                          → system
//   defineSkill     → { systemPrompt: body, tools }             → system + tools
//   defineGuardrail → { systemPrompt } (rule trigger)           → system
//   memory recall   → system-role → system, else → messages     → messages (+ system)
//   RAG             → SystemPrompt reference block / re-inject   → system (+ messages)
//   defineFact      → slot default 'system-prompt' | 'messages' → system (+ messages)
//   tools registry  → tools                                     → tools
const FLAVOR_MAP: FlavorMapEntry[] = [
  {
    name: 'Steering',
    color: 'teal',
    slots: [{ slot: 0, strong: true }],
    blurb: (
      <>
        Always-on instructions that shape behavior — lands in <b>system</b>, every iteration.
        <span className="src">defineSteering → systemPrompt</span>
      </>
    ),
  },
  {
    name: 'Skill',
    color: 'coral',
    slots: [
      { slot: 0, strong: true },
      { slot: 2, strong: true },
    ],
    blurb: (
      <>
        Two parts: its <b>body → system</b>, its <b>tools → tools</b>. The model unlocks it by calling{' '}
        <code>read_skill</code>.<span className="src">defineSkill → {'{ systemPrompt: body, tools }'}</span>
      </>
    ),
  },
  {
    name: 'Guardrail',
    color: 'amber',
    slots: [{ slot: 0, strong: true }],
    blurb: (
      <>
        A rule that fires when its checker trips, adding a note to <b>system</b>.
        <span className="src">defineGuardrail → systemPrompt (rule)</span>
      </>
    ),
  },
  {
    name: 'Memory',
    color: 'purple',
    slots: [
      { slot: 1, strong: true },
      { slot: 0, strong: false },
    ],
    blurb: (
      <>
        Recalled state: most rides in <b>messages</b>; system-role items go to <b>system</b>.
        <span className="src">memory recall → by role</span>
      </>
    ),
  },
  {
    name: 'RAG',
    color: 'purple',
    slots: [
      { slot: 0, strong: true },
      { slot: 1, strong: false },
    ],
    blurb: (
      <>
        Retrieved context: usually a <b>system</b> reference block, can re-inject as <b>messages</b>.
        <span className="src">source: &apos;rag&apos;</span>
      </>
    ),
  },
  {
    name: 'Fact',
    color: 'slate',
    slots: [
      { slot: 0, strong: true },
      { slot: 1, strong: false },
    ],
    blurb: (
      <>
        Known data. Defaults to <b>system</b>; opt into <b>messages</b> for inline facts.
        <span className="src">defineFact → systemPrompt | messages</span>
      </>
    ),
  },
  {
    name: 'Tool API',
    color: 'coral',
    slots: [{ slot: 2, strong: true }],
    blurb: (
      <>
        External functions the model can call — always the <b>tools</b> slot.
        <span className="src">.tool() → tools</span>
      </>
    ),
  },
];
const SLOT_NAMES = ['system', 'messages', 'tools'];
// fixed x-fractions (0–100) so the SVG wires line up with the equal-width flex pills/slots
const FLAVOR_X = FLAVOR_MAP.map((_, i) => ((i + 0.5) / FLAVOR_MAP.length) * 100);
const SLOT_X = SLOT_NAMES.map((_, j) => ((j + 0.5) / SLOT_NAMES.length) * 100);

// ---------- (b) Triggers scroller — reuses the backtrack ReAct flowchart ----------
// Same chart the reader met in Chapter 1; each beat lights WHERE in the loop a trigger fires and
// tags that node with the trigger word. Node/edge coords are lifted verbatim from BacktrackStory
// (only the final node is relabelled to the neutral '→ answer', since this isn't the bug story).
type TNode = { n: string; nt: string; ns?: string; x: number; y: number; cls?: string };
const TRIG_NODES: TNode[] = [
  { n: 'ctx', nt: 'Context', ns: 'ReAct loop', x: 50, y: 9 },
  { n: 'sys', nt: 'System Prompt', x: 18, y: 26, cls: 'slot' },
  { n: 'msg', nt: 'Messages', x: 50, y: 26, cls: 'slot' },
  { n: 'tool', nt: 'Tools', x: 82, y: 26, cls: 'slot' },
  { n: 'api', nt: 'messageAPI', ns: 'assemble', x: 50, y: 46 },
  { n: 'llm', nt: 'CallLLM', ns: 'send request', x: 50, y: 64 },
  { n: 'route', nt: 'Route', x: 50, y: 83, cls: 'diamond' },
  { n: 'final', nt: '→ answer', x: 21, y: 96, cls: 'end' },
  { n: 'tc', nt: 'ToolCalls', ns: '↻ loop again', x: 79, y: 96 },
];
const TRIG_EDGES: { e: string; d: string; loop?: boolean }[] = [
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
type TrigBeat = {
  trigger: string;
  hl: string; // highlight color (a var() ref) for lit nodes/edges + the tag, scoped to this chart
  tagNode: string;
  litNodes: string[];
  litEdges: string[];
  weakNodes?: string[]; // secondary slot this trigger CAN also land in (dashed)
  weakEdges?: string[];
  code: string; // the one-line define* call for this trigger (shown in the aside)
  aside: ReactNode;
};
// slot routing verified against the engine (evaluator.ts + buildSystemPromptSlot.ts), not the README.
const TRIG_BEATS: TrigBeat[] = [
  {
    trigger: 'always',
    hl: 'var(--teal)',
    tagNode: 'sys',
    litNodes: ['sys'],
    litEdges: ['ctx-sys'],
    code: 'defineSteering({ id, prompt })',
    aside: (
      <>
        <b>always</b> — re-injected into <b>system</b> on <i>every</i> iteration: the invariants
        (persona, format, safety). <span className="src">defineSteering → systemPrompt</span>
      </>
    ),
  },
  {
    trigger: 'rule',
    hl: 'var(--purple)',
    tagNode: 'sys',
    litNodes: ['sys'],
    litEdges: ['ctx-sys'],
    weakNodes: ['msg'],
    weakEdges: ['ctx-msg'],
    code: 'defineInstruction({ id, activeWhen, prompt })',
    aside: (
      <>
        <b>rule</b> — a predicate runs each iteration; true → the text lands in <b>system</b> (or{' '}
        <b>messages</b>, your choice). The most flexible kind.{' '}
        <span className="src">defineInstruction → systemPrompt | messages</span>
      </>
    ),
  },
  {
    trigger: 'on-tool-return',
    hl: 'var(--amber)',
    tagNode: 'tc',
    litNodes: ['tc', 'sys'],
    litEdges: ['ctx-sys'],
    weakNodes: ['msg'],
    weakEdges: ['ctx-msg'],
    code: 'defineInstruction({ activeWhen: c => c.lastToolResult, prompt })',
    aside: (
      <>
        <b>on-tool-return</b> — after a specific tool returns, the <b>loop</b> carries a note into the
        next prompt: <b>system</b> by default, or <b>messages</b> for recency/higher attention. In
        practice a <code>rule</code> predicate on <code>ctx.lastToolResult</code>.{' '}
        <span className="src">evaluator matches toolName; inject decides the slot</span>
      </>
    ),
  },
  {
    trigger: 'llm-activated',
    hl: 'var(--coral)',
    tagNode: 'llm',
    litNodes: ['llm', 'sys', 'tool'],
    litEdges: ['ctx-sys', 'ctx-tool'],
    weakNodes: ['msg'],
    weakEdges: ['ctx-msg'],
    code: 'defineSkill({ id, description, body, tools })',
    aside: (
      <>
        <b>llm-activated</b> — the model unlocks it by calling <code>read_skill</code> at{' '}
        <b>CallLLM</b>: body → <b>system</b>, its tools → <b>tools</b>. With{' '}
        <code>surfaceMode: &apos;tool-only&apos;</code> the body rides the read_skill{' '}
        <b>tool result</b> (a message) instead. <span className="src">defineSkill → systemPrompt + tools</span>
      </>
    ),
  },
];

// ---------- (d) Dynamic ReAct stepper ----------
type ChipColor = 'teal' | 'purple' | 'coral' | 'amber' | 'tool' | 'tool new';
type Step = {
  sysBadge: string;
  sys: { color: ChipColor; label: string }[];
  toolBadge: string;
  toolCount: string;
  track: number;
  tools: { color: ChipColor; label: string }[];
  decision: ReactNode;
  loop: string;
  footHead: string;
  footRest: string;
};
const STEPS: Step[] = [
  {
    sysBadge: 'steering only',
    sys: [{ color: 'teal', label: 'steering: refund-policy' }],
    toolBadge: '1 shown',
    toolCount: '1',
    track: 8,
    tools: [{ color: 'tool', label: 'read_skill' }],
    decision: (
      <>
        &ldquo;This is a billing task — I need the billing skill.&rdquo; &rarr; calls{' '}
        <code>read_skill(&apos;billing&apos;)</code>
      </>
    ),
    loop: '↻ loop returns to SystemPrompt — the read_skill result will recompose the next prompt.',
    footHead: 'Iteration 1',
    footRest: 'the catalog stays clean. The model sees one tool: a door to ask for more.',
  },
  {
    sysBadge: '+ skill body',
    sys: [
      { color: 'teal', label: 'steering: refund-policy' },
      { color: 'coral', label: 'skill body: billing' },
    ],
    toolBadge: '5 shown',
    toolCount: '5',
    track: 42,
    tools: [
      { color: 'tool', label: 'read_skill' },
      { color: 'tool new', label: 'refundTool' },
      { color: 'tool new', label: 'lookupCharge' },
      { color: 'tool new', label: 'issueCredit' },
      { color: 'tool new', label: 'escalate' },
    ],
    decision: (
      <>
        Billing tools now in-window. &ldquo;Look up the last charge first.&rdquo; &rarr; calls{' '}
        <code>lookupCharge()</code>
      </>
    ),
    loop: '↻ recomposed: the skill’s body landed in system, its 4 tools unlocked into the tools slot.',
    footHead: 'Iteration 2',
    footRest:
      'the skill activated. System prompt grew by one block; tools went 1 → 5, exactly the ones this task needs.',
  },
  {
    sysBadge: '+ tool-return note',
    sys: [
      { color: 'teal', label: 'steering: refund-policy' },
      { color: 'coral', label: 'skill body: billing' },
      { color: 'amber', label: 'on-return: cite charge id' },
    ],
    toolBadge: '5 shown',
    toolCount: '5',
    track: 42,
    tools: [
      { color: 'tool', label: 'read_skill' },
      { color: 'tool', label: 'refundTool' },
      { color: 'tool', label: 'lookupCharge' },
      { color: 'tool', label: 'issueCredit' },
      { color: 'tool', label: 'escalate' },
    ],
    decision: (
      <>
        Charge found, policy satisfied. &rarr; calls <code>refundTool()</code>, then answers.
      </>
    ),
    loop: '↻ an on-tool-return instruction fired after lookupCharge — added to system for this turn only.',
    footHead: 'Iteration 3',
    footRest: 'tools hold at 5. Classic ReAct would still be carrying all 12, every single turn.',
  },
];

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion:reduce)').matches;

export function ContextEngineering() {
  return (
    <section className="af-ctx">
      {/* ---------- HERO ---------- */}
      <div className="af-ctx-hero">
        <p className="af-ctx-eyebrow">02 · how we abstract</p>
        <h1>
          Context engineering, <em>abstracted.</em>
        </h1>
        <p className="af-ctx-lede-hero">
          Skills, steering, RAG, facts, memory, guardrails — every name for context does the same
          move: it injects into one of three LLM slots, under one of four triggers. So we abstracted
          the injection itself.
        </p>
        <div className="af-ctx-formula">
          <span>Injection</span>
          <span className="op">=</span>
          <span className="s1">slot</span>
          <span className="op">&times;</span>
          <span className="s2">trigger</span>
          <span className="op">&times;</span>
          <span className="s3">cache</span>
        </div>
      </div>

      <AbstractionBlock />
      <TriggersBlock />
      <CodeBlock />
      <DynamicReactBlock />
    </section>
  );
}

// ============ (a) ABSTRACTION MAP — scroll-driven flavor → slot(s) ============
// Pinned scroller: flavors in a row up top, the 3-slot LLM box below; scrolling steps through
// each flavor, drawing wire(s) to the slot(s) it REALLY injects into (ground truth from the
// injection-engine factories), with a right-side aside explaining it. Several flavors are
// many-to-many (Skill → system + tools; Memory/RAG/Fact → system + messages).
function AbstractionBlock() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState(0);
  const LAST = FLAVOR_MAP.length; // phases 0 (intro) .. LAST (each flavor = phase i for flavor i-1)

  useEffect(() => {
    if (prefersReducedMotion()) {
      setPhase(LAST);
      return;
    }
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
  }, [LAST]);

  const active = phase - 1; // -1 during the intro beat
  const activeFlavor = active >= 0 ? FLAVOR_MAP[active] : null;

  return (
    <section className="af-ctx-block">
      <p className="af-ctx-kicker">The model — what we abstract</p>
      <h2>
        Many flavors. <em>Three slots.</em>
      </h2>
      <p className="af-ctx-lede">
        The data and instructions you collect wear many names. Each lands in <b>system</b>,{' '}
        <b>messages</b>, or <b>tools</b> — and several land in <i>more than one</i>. Scroll to map each
        flavor to the slot(s) it really injects into.
      </p>

      <div className="af-ctx-map-track" ref={trackRef}>
        <div className="af-ctx-map-stage">
          <div className="af-ctx-map-row">
            <div className="af-ctx-map-diagram">
              {/* flavors, in a row across the top */}
              <div className="af-ctx-map-flavors">
                {FLAVOR_MAP.map((f, i) => (
                  <span
                    key={f.name}
                    className={`af-ctx-mflav ${f.color}${i === active ? ' active' : i < active ? ' placed' : ''}`}
                  >
                    <span className={`af-ctx-dot ${f.color}`} />
                    {f.name}
                  </span>
                ))}
              </div>

              {/* wires: the active flavor → its slot(s) */}
              <svg className="af-ctx-map-wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {activeFlavor?.slots.map((s) => {
                  const xf = FLAVOR_X[active];
                  const xs = SLOT_X[s.slot];
                  const d = `M ${xf},2 C ${xf},52 ${xs},48 ${xs},98`;
                  return (
                    <path
                      key={`${phase}-${s.slot}`}
                      d={d}
                      className={`af-ctx-wire ${activeFlavor.color}${s.strong ? '' : ' weak'}`}
                    />
                  );
                })}
              </svg>

              {/* the LLM call box with its three slots */}
              <div className="af-ctx-map-llm">
                <span className="af-ctx-stage-label">one LLM call</span>
                <div className="af-ctx-map-slots">
                  {SLOT_NAMES.map((nm, j) => {
                    const chips = FLAVOR_MAP.map((f, fi) => ({ f, fi })).filter(
                      ({ f, fi }) => fi <= active && f.slots.some((s) => s.slot === j),
                    );
                    const activeHere = activeFlavor?.slots.some((s) => s.slot === j) ?? false;
                    return (
                      <div key={nm} className={`af-ctx-map-slot${activeHere ? ' hit' : ''}`}>
                        {activeHere && <span className={`af-ctx-map-tri ${activeFlavor!.color}`} />}
                        <div className="af-ctx-map-chips">
                          {chips.map(({ f, fi }) => {
                            const mem = f.slots.find((s) => s.slot === j)!;
                            return (
                              <span
                                key={f.name}
                                className={`af-ctx-pill ${f.color}${mem.strong ? '' : ' weak'}${fi === active ? ' show' : ''}`}
                              >
                                {f.name}
                              </span>
                            );
                          })}
                        </div>
                        <span className="af-ctx-snm">{nm}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* aside: explain the active flavor + where it lands and why */}
            <aside className="af-ctx-map-aside">
              <span className="af-ctx-map-prog" aria-hidden="true">
                <span className="fill" style={{ height: `${(phase / LAST) * 100}%` }} />
              </span>
              <p className="af-ctx-kicker2">where each flavor lands</p>
              {activeFlavor ? (
                <>
                  <p className="af-ctx-map-name">
                    <span className={`af-ctx-dot ${activeFlavor.color}`} />
                    {activeFlavor.name}
                  </p>
                  <p className="af-ctx-map-blurb">{activeFlavor.blurb}</p>
                </>
              ) : (
                <>
                  <p className="af-ctx-map-name">Many flavors → three slots</p>
                  <p className="af-ctx-map-blurb">
                    Every flavor of context injects into <b>system</b>, <b>messages</b>, or{' '}
                    <b>tools</b> — and several into more than one. <b>Scroll</b> to map each to where it
                    really lands.
                  </p>
                </>
              )}
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============ (b) TRIGGERS SCROLLER — when each trigger fires, ON the ReAct loop ============
// Reuses the Chapter-1 backtrack flowchart. Each beat lights where in the loop a trigger acts and
// tags that node with the trigger word; the aside explains it (slots verified against engine code).
function TriggersBlock() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState(0);
  const LAST = TRIG_BEATS.length; // phases 0 (intro) .. LAST (one per trigger)

  useEffect(() => {
    if (prefersReducedMotion()) {
      setPhase(LAST);
      return;
    }
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
  }, [LAST]);

  const beat = phase >= 1 ? TRIG_BEATS[phase - 1] : null;
  const litN = new Set(beat?.litNodes ?? []);
  const litE = new Set(beat?.litEdges ?? []);
  const weakN = new Set(beat?.weakNodes ?? []);
  const weakE = new Set(beat?.weakEdges ?? []);

  // click a trigger pill → scroll to that beat's band
  const goToBeat = (k: number) => {
    const track = trackRef.current;
    if (!track) return;
    const total = track.offsetHeight - window.innerHeight;
    const trackTop = track.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: trackTop + ((k + 0.5) / (LAST + 1)) * total, behavior: 'smooth' });
  };

  return (
    <section className="af-ctx-block">
      <p className="af-ctx-kicker">When each one fires</p>
      <h2>
        Four triggers decide <em>when.</em>
      </h2>
      <p className="af-ctx-lede">
        A slot says <b>where</b> content lands; a trigger says <b>when</b> it fires. Scroll to watch
        each kind light up <i>where in the loop</i> it acts — from always-on rules to context the model
        unlocks itself by calling <code className="af-ctx-mono">read_skill</code>.
      </p>

      <div className="af-trig-track" ref={trackRef}>
        <div className="af-pin-stage af-flowwrap">
          <div className="af-bt-row">
            <div className="af-bt-left">
              <div className="af-trig-pills">
                {TRIG_BEATS.map((b, i) => (
                  <button
                    key={b.trigger}
                    type="button"
                    className={`af-trig-pill${i + 1 === phase ? ' active' : i + 1 < phase ? ' done' : ''}`}
                    style={{ '--tp-hl': b.hl } as CSSProperties}
                    onClick={() => goToBeat(i + 1)}
                  >
                    <span className="dot" />
                    {b.trigger}
                  </button>
                ))}
              </div>
              <div
                className="af-flow"
                style={{ '--trig-hl': beat?.hl ?? 'var(--coral)' } as CSSProperties}
              >
                <svg className="edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {TRIG_EDGES.map((ed) => (
                    <path
                      key={ed.e}
                      d={ed.d}
                      pathLength={1}
                      className={`fe${ed.loop ? ' loop' : ''}${litE.has(ed.e) ? ' lit' : ''}${weakE.has(ed.e) ? ' weak-lit' : ''}`}
                    />
                  ))}
                  {/* the loop is a light-grey divider; a small grey arrowhead on its visible top
                      segment (just right of Context) points back into Context */}
                  <path className="af-trig-loop-arrow" d="M-1.5,-1.3 L1.5,0 L-1.5,1.3 Z" transform="translate(64 5) rotate(180)" />
                </svg>
                {TRIG_NODES.map((nd) => {
                  const cls = [
                    'fnode',
                    nd.cls || '',
                    litN.has(nd.n) ? 'lit' : '',
                    weakN.has(nd.n) ? 'weak-lit' : '',
                  ].join(' ');
                  return (
                    <div key={nd.n} className={cls} style={{ left: `${nd.x}%`, top: `${nd.y}%` }}>
                      {beat?.tagNode === nd.n && (
                        <span key={`tag-${phase}`} className="af-trig-tag">
                          {beat.trigger}
                        </span>
                      )}
                      <span className="nt">{nd.nt}</span>
                      {nd.ns && <span className="ns">{nd.ns}</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            <aside className="af-flow-aside">
              <span className="af-aside-prog" aria-hidden="true">
                <span className="af-aside-fill" style={{ height: `${(phase / LAST) * 100}%` }} />
              </span>
              <p className="af-flow-kicker">when does it fire?</p>
              <p className="af-flow-head">
                Four triggers, <em>on the loop.</em>
              </p>
              <p className="af-tl-cap">
                {beat ? (
                  beat.aside
                ) : (
                  <>
                    A <b>slot</b> is where content lands; a <b>trigger</b> is <i>when</i>. Four kinds —
                    scroll to see each light up where in the ReAct loop it fires.
                  </>
                )}
              </p>
              {beat && (
                <code className="af-trig-code" style={{ borderLeftColor: beat.hl } as CSSProperties}>
                  {beat.code}
                </code>
              )}
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============ (c) CODE PANEL ============
function CodeBlock() {
  return (
    <section className="af-ctx-block">
      <p className="af-ctx-kicker">In your code</p>
      <h2>
        Declare the flavor. <em>Not the prompt string.</em>
      </h2>
      <p className="af-ctx-lede">
        You attach typed pieces — a fact, a rule, a skill. The framework decides <b>which slot</b> and{' '}
        <b>which iteration</b> each fires on, places the cache markers, and records every injection it
        makes.
      </p>
      <div className="af-ctx-code">
        <div className="af-ctx-chrome">
          <span className="af-ctx-dots">
            <span />
            <span />
            <span />
          </span>
          <span className="af-ctx-fn">support-agent.ts</span>
        </div>
        <pre>
          <span className="k">const</span> <span className="m">agent</span> <span className="p">=</span>{' '}
          <span className="m">Agent</span>
          <span className="p">.</span>
          <span className="m">create</span>
          <span className="p">({'({'}</span> <span className="m">provider</span>
          <span className="p">,</span> <span className="m">model</span> <span className="p">{'})'}</span>
          {'\n'}
          {'  '}
          <span className="p">.</span>
          <span className="m">system</span>
          <span className="p">(</span>
          <span className="s">&apos;You are a support agent.&apos;</span>
          <span className="p">)</span>
          {'\n'}
          {'  '}
          <span className="p">.</span>
          <span className="m">fact</span>
          <span className="p">(</span>
          <span className="m">defineFact</span>
          <span className="p">({'({'}</span>
          {'           '}
          <span className="c cm-purple">{'// data — always on → system'}</span>
          {'\n'}
          {'    '}
          <span className="m">id</span>
          <span className="p">:</span> <span className="s">&apos;user-profile&apos;</span>
          <span className="p">,</span>
          {'\n'}
          {'    '}
          <span className="m">data</span>
          <span className="p">:</span>{' '}
          <span className="s">&apos;Name: Maya · Plan: Pro · since 2022&apos;</span>
          <span className="p">,</span>
          {'\n'}
          {'  '}
          <span className="p">{'}))'}</span>
          {'\n'}
          {'  '}
          <span className="p">.</span>
          <span className="m">steering</span>
          <span className="p">(</span>
          <span className="m">defineSteering</span>
          <span className="p">({'({'}</span>
          {'   '}
          <span className="c cm-teal">{'// steering — always on → system'}</span>
          {'\n'}
          {'    '}
          <span className="m">id</span>
          <span className="p">:</span> <span className="s">&apos;refund-policy&apos;</span>
          <span className="p">,</span>
          {'\n'}
          {'    '}
          <span className="m">prompt</span>
          <span className="p">:</span>{' '}
          <span className="s">&apos;Never promise a refund before checking policy.&apos;</span>
          <span className="p">,</span>
          {'\n'}
          {'  '}
          <span className="p">{'}))'}</span>
          {'\n'}
          {'  '}
          <span className="p">.</span>
          <span className="m">skill</span>
          <span className="p">(</span>
          <span className="m">defineSkill</span>
          <span className="p">({'({'}</span>
          {'         '}
          <span className="c cm-coral">{'// unlocks via read_skill → system + tools'}</span>
          {'\n'}
          {'    '}
          <span className="m">id</span>
          <span className="p">:</span> <span className="s">&apos;billing&apos;</span>
          <span className="p">,</span>
          {'\n'}
          {'    '}
          <span className="m">description</span>
          <span className="p">:</span>{' '}
          <span className="s">&apos;Use for refunds, charges, billing.&apos;</span>
          <span className="p">,</span>
          {'\n'}
          {'    '}
          <span className="m">body</span>
          <span className="p">:</span>{' '}
          <span className="s">&apos;Confirm identity first, then…&apos;</span>
          <span className="p">,</span>
          {'\n'}
          {'    '}
          <span className="m">tools</span>
          <span className="p">:</span> <span className="p">[</span>
          <span className="m">refundTool</span>
          <span className="p">,</span> <span className="m">lookupCharge</span>
          <span className="p">,</span> <span className="m">issueCredit</span>
          <span className="p">],</span>
          {'\n'}
          {'  '}
          <span className="p">{'}))'}</span>
          {'\n'}
          {'  '}
          <span className="p">.</span>
          <span className="m">build</span>
          <span className="p">();</span>
        </pre>
      </div>
    </section>
  );
}

// ============ (d) DYNAMIC REACT — scroll-driven flowchart traversal ============
// Same ReAct flowchart; scrolling walks iterations 1→3. Each iter lights the path taken and the
// slot contents recompose (system grows, tools 1→5). The token punchline (5 vs 12) stays in the aside.
type StepFlow = { litNodes: string[]; litEdges: string[] };
const STEP_FLOW: StepFlow[] = [
  // iter 1 — steering only; model calls read_skill, then loops
  {
    litNodes: ['ctx', 'sys', 'api', 'llm', 'route', 'tc'],
    litEdges: ['ctx-sys', 'sys-api', 'api-llm', 'llm-route', 'route-tc', 'loop'],
  },
  // iter 2 — skill body in system, 5 tools unlocked; model calls a tool, loops
  {
    litNodes: ['ctx', 'sys', 'tool', 'api', 'llm', 'route', 'tc'],
    litEdges: ['ctx-sys', 'ctx-tool', 'sys-api', 'tool-llm', 'api-llm', 'llm-route', 'route-tc', 'loop'],
  },
  // iter 3 — refund done; model answers (Route → answer), no loop
  {
    litNodes: ['ctx', 'sys', 'tool', 'api', 'llm', 'route', 'final'],
    litEdges: ['ctx-sys', 'ctx-tool', 'sys-api', 'tool-llm', 'api-llm', 'llm-route', 'route-final'],
  },
];

function DynamicReactBlock() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const LAST = STEPS.length - 1; // iterations 0..2

  useEffect(() => {
    if (prefersReducedMotion()) {
      setI(LAST);
      return;
    }
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const track = trackRef.current;
        if (!track) return;
        const rect = track.getBoundingClientRect();
        const total = rect.height - window.innerHeight;
        const p = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
        setI(Math.min(LAST, Math.floor(p * (LAST + 1))));
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
  }, [LAST]);

  const goToIter = (k: number) => {
    const track = trackRef.current;
    if (!track) return;
    const total = track.offsetHeight - window.innerHeight;
    const trackTop = track.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: trackTop + ((k + 0.5) / (LAST + 1)) * total, behavior: 'smooth' });
  };

  const s = STEPS[i];
  const f = STEP_FLOW[i];
  const litN = new Set(f.litNodes);
  const litE = new Set(f.litEdges);

  return (
    <section className="af-ctx-block">
      <p className="af-ctx-kicker">How the assembly runs</p>
      <h2>
        The prompt <em>recomposes</em> every iteration.
      </h2>
      <p className="af-ctx-lede">
        The model reasons, decides which skill it needs, and the framework{' '}
        <b>re-assembles the system prompt and the tool list</b> around that decision. Tools the model
        can&apos;t use yet never enter the window — so the context shrinks to what the step needs, and
        the token bill drops with it. <b>Scroll</b> to walk the three iterations.
      </p>

      <div className="af-dyn-track" ref={trackRef}>
        <div className="af-pin-stage af-flowwrap">
          <div className="af-dyn-top">
            <p className="af-ctx-dyn-q">
              Task: <b>&ldquo;Refund my last charge.&rdquo;</b>
            </p>
            <div className="af-ctx-iters">
              {STEPS.map((_, k) => (
                <button key={k} type="button" className={k === i ? 'on' : ''} onClick={() => goToIter(k)}>
                  iter&nbsp;{k + 1}
                </button>
              ))}
            </div>
          </div>

          <div className="af-bt-row">
            <div className="af-bt-left">
              <div className="af-flow">
                <svg className="edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {TRIG_EDGES.map((ed) => (
                    <path
                      key={ed.e}
                      d={ed.d}
                      pathLength={1}
                      className={`fe${ed.loop ? ' loop' : ''}${litE.has(ed.e) ? ' lit' : ''}`}
                    />
                  ))}
                </svg>
                {TRIG_NODES.map((nd) => {
                  const cls = ['fnode', nd.cls || '', litN.has(nd.n) ? 'lit' : ''].join(' ');
                  return (
                    <div key={nd.n} className={cls} style={{ left: `${nd.x}%`, top: `${nd.y}%` }}>
                      {/* the recomposition, on the chart: tool count (1→5) + the growing system */}
                      {nd.n === 'tool' && (
                        <span key={`tc-${i}`} className="af-dyn-count">
                          {s.toolCount}
                        </span>
                      )}
                      {nd.n === 'sys' && (
                        <span key={`sb-${i}`} className="af-dyn-sysbadge">
                          {s.sysBadge}
                        </span>
                      )}
                      <span className="nt">{nd.nt}</span>
                      {nd.ns && <span className="ns">{nd.ns}</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            <aside className="af-flow-aside af-dyn-aside">
              <span className="af-aside-prog" aria-hidden="true">
                <span className="af-aside-fill" style={{ height: `${(i / LAST) * 100}%` }} />
              </span>
              <p className="af-flow-kicker">iteration {i + 1} of 3</p>
              <div className="af-ctx-decision">
                <p className="dh">the model decides</p>
                <p className="dt">{s.decision}</p>
              </div>
              <div className="af-ctx-reqslot">
                <p className="h">
                  tools <span className={`badge${i === 1 ? ' grow' : ''}`}>{s.toolBadge}</span>
                </p>
                <div className="af-ctx-chips">
                  {s.tools.map((c, n) => (
                    <span
                      key={`${i}-tool-${c.label}`}
                      className={`af-ctx-chip ${c.color}`}
                      style={{ animationDelay: `${n * 50}ms` } as CSSProperties}
                    >
                      {c.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="af-ctx-tokenbar">
                <div className="tlab">
                  <span>tools in window</span>
                  <span>
                    <b>{s.toolCount}</b> vs 12 classic
                  </span>
                </div>
                <div className="af-ctx-track">
                  <div className="classic" />
                  <div className="dynamic" style={{ width: `${s.track}%` }} />
                </div>
              </div>
              <p className="af-tl-cap af-dyn-cap">
                <b>{s.footHead}</b> — {s.footRest}
              </p>
            </aside>
          </div>
        </div>
      </div>

      <div className="af-ctx-compare">
        <div className="af-ctx-cc classic">
          <h4>Classic ReAct</h4>
          <p>
            The loop returns to <b>CallLLM</b>. Slots freeze after iteration 1 — all 12 tools ride
            along every turn, whether the step needs them or not.
          </p>
          <p className="loopnote">loop edge &rarr; CallLLM · 12 tools &times; every iteration</p>
        </div>
        <div className="af-ctx-cc dynamic">
          <h4>Dynamic ReAct — agentfootprint</h4>
          <p>
            The loop returns to <b>SystemPrompt</b>. Every turn recomposes: injections that fired on
            the last tool result rewrite the next prompt, tools appear only once unlocked.
          </p>
          <p className="loopnote">loop edge &rarr; SystemPrompt · 1 &rarr; 5 tools, on demand</p>
        </div>
      </div>
    </section>
  );
}
