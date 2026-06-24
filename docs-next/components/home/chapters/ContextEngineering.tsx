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

// ---------- (b) Triggers table ----------
const TRIGGERS: {
  cls: 'teal' | 'purple' | 'amber' | 'coral';
  trigger: string;
  flavor: string;
  when: string;
  slot: string;
}[] = [
  { cls: 'teal', trigger: 'always', flavor: 'Steering', when: 'every iteration', slot: 'system' },
  { cls: 'purple', trigger: 'rule', flavor: 'Instruction', when: 'your predicate returns true', slot: 'system' },
  { cls: 'amber', trigger: 'on-tool-return', flavor: 'Instruction', when: 'after a specific tool returns', slot: 'system' },
  { cls: 'coral', trigger: 'llm-activated', flavor: 'Skill', when: "LLM calls read_skill('id')", slot: 'system + tools' },
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

// ============ (b) TRIGGERS TABLE ============
function TriggersBlock() {
  return (
    <section className="af-ctx-block">
      <p className="af-ctx-kicker">When each one fires</p>
      <h2>
        Four triggers decide <em>when.</em>
      </h2>
      <p className="af-ctx-lede">
        A slot says <b>where</b> content lands; a trigger says <b>when</b> it fires. Four kinds cover
        the whole field — from always-on rules to context the model unlocks itself by calling{' '}
        <code className="af-ctx-mono">read_skill</code>.
      </p>
      <div className="af-ctx-trigtable">
        <div className="af-ctx-trow r-head">
          <div>trigger</div>
          <div>flavor</div>
          <div className="c3">fires when</div>
          <div className="c4">slot</div>
        </div>
        {TRIGGERS.map((t) => (
          <div key={t.trigger} className={`af-ctx-trow r-${t.cls}`}>
            <div className="tg">{t.trigger}</div>
            <div className="fl">{t.flavor}</div>
            <div className="c3">{t.when}</div>
            <div className="sl c4">{t.slot}</div>
          </div>
        ))}
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
          <span className="c cm-purple">{'// data — always on → messages'}</span>
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
          <span className="c cm-teal">{'// rule — always on → system'}</span>
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
          <span className="c cm-coral">{'// unlocks when the LLM asks'}</span>
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

// ============ (d) DYNAMIC REACT STEPPER ============
function DynamicReactBlock() {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const dynRef = useRef<HTMLDivElement>(null);
  const autoRef = useRef(auto);
  autoRef.current = auto;

  useEffect(() => {
    if (prefersReducedMotion()) return;

    let started = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !started) {
            started = true;
            timer = setInterval(() => {
              if (!autoRef.current) return;
              setI((prev) => (prev + 1) % STEPS.length);
            }, 2600);
          }
        });
      },
      { threshold: 0.4 },
    );
    if (dynRef.current) io.observe(dynRef.current);

    return () => {
      io.disconnect();
      if (timer) clearInterval(timer);
    };
  }, []);

  const s = STEPS[i];

  return (
    <section className="af-ctx-block">
      <p className="af-ctx-kicker">How the assembly runs</p>
      <h2>
        The prompt <em>recomposes</em> every iteration.
      </h2>
      <p className="af-ctx-lede">
        This is the engineering: the model reasons, decides which skill it needs, and on the next turn
        the framework <b>re-assembles the system prompt and the tool list</b> around that decision.
        Tools the model can&apos;t use yet never enter the window — so the context shrinks to what the
        step needs, and the token bill drops with it.
      </p>

      <div className="af-ctx-dyn" ref={dynRef}>
        <div className="af-ctx-dyn-top">
          <p className="af-ctx-dyn-q">
            Task: <b>&ldquo;Refund my last charge.&rdquo;</b>
          </p>
          <div className="af-ctx-iters">
            {STEPS.map((_, k) => (
              <button
                key={k}
                type="button"
                className={k === i ? 'on' : ''}
                onClick={() => {
                  setI(k);
                  setAuto(false);
                }}
              >
                iter&nbsp;{k + 1}
              </button>
            ))}
          </div>
        </div>

        <div className="af-ctx-dyn-body">
          <div className="af-ctx-dyn-call">
            <p className="af-ctx-lab">system prompt + tools, assembled for this iteration</p>
            <div className="af-ctx-reqslot">
              <p className="h">
                system <span className={`badge${i > 0 ? ' grow' : ''}`}>{s.sysBadge}</span>
              </p>
              <div className="af-ctx-chips">
                {s.sys.map((c, n) => (
                  <span
                    key={`${i}-sys-${c.label}`}
                    className={`af-ctx-chip ${c.color}`}
                    style={{ animationDelay: `${n * 60}ms` } as CSSProperties}
                  >
                    {c.label}
                  </span>
                ))}
              </div>
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
                    style={{ animationDelay: `${n * 60}ms` } as CSSProperties}
                  >
                    {c.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="af-ctx-dyn-side">
            <div className="af-ctx-decision">
              <p className="dh">the model decides</p>
              <p className="dt">{s.decision}</p>
            </div>
            <div className="af-ctx-loopback">{s.loop}</div>
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
          </div>
        </div>

        <div className="af-ctx-dyn-foot">
          <b>{s.footHead}</b> — {s.footRest}
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
