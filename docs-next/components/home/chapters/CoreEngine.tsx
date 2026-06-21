'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Chapter 3 — "The engine". The deep "how it's implemented" beat: a ReAct loop that
 * RECORDS ITSELF. Two halves, scroll-pinned + cross-faded:
 *
 *  Layer A (the live drain log) — the loop runs on a timer; each recorded step
 *  (prompt · inject · ask · return · answer · loop) appends to a typed log and lights
 *  the matching node + edge on the constant left-hand flowchart. A running ms/tok/steps
 *  tally accumulates. (IntersectionObserver-gated; reduced-motion shows the final state.)
 *
 *  Layer B (the idle-beat dispatch runtime) — as you scroll the pin, the right side
 *  cross-fades from the log to a vertical event-loop diagram: the stage queues trace
 *  events (onStageAdded · onCommit · onDecision · onEmit) on the hot path; the IDLE BEAT
 *  flushes them to listeners + trace memory ONE BEAT BEHIND — collect during traversal,
 *  off the critical path, zero added latency. The headline cross-fades too:
 *  "The loop records itself." → "And it costs the run nothing."
 */

type StepKind = 'prompt' | 'inject' | 'ask' | 'ret' | 'answer' | 'loop';
type NodeId = 'ctx' | 'sys' | 'msg' | 'tool' | 'api' | 'llm' | 'route' | 'final' | 'tc';
type EdgeId =
  | 'ctx-sys'
  | 'ctx-msg'
  | 'ctx-tool'
  | 'sys-api'
  | 'msg-api'
  | 'api-llm'
  | 'tool-llm'
  | 'llm-route'
  | 'route-final'
  | 'route-tc'
  | 'loop';

type Step = {
  kind: StepKind;
  label: string;
  text: React.ReactNode;
  ms: number;
  tok: number;
  node: NodeId;
  edge?: EdgeId;
};

// One ReAct iteration, as recorded steps.
const STEPS: Step[] = [
  { kind: 'prompt', label: 'prompt', text: 'assemble context for the call', ms: 180, tok: 90, node: 'ctx' },
  {
    kind: 'inject',
    label: 'rule ↳',
    text: (
      <>
        <b>always</b> &rarr; steering into <b>system</b>
      </>
    ),
    ms: 60,
    tok: 40,
    node: 'sys',
    edge: 'ctx-sys',
  },
  {
    kind: 'inject',
    label: 'rule ↳',
    text: (
      <>
        memory rule fires &rarr; <b>messages</b>
      </>
    ),
    ms: 80,
    tok: 120,
    node: 'msg',
    edge: 'ctx-msg',
  },
  {
    kind: 'ask',
    label: 'ask',
    text: (
      <>
        call <b>search_hotels</b>({'{ city: "Lisbon" }'})
      </>
    ),
    ms: 260,
    tok: 120,
    node: 'llm',
    edge: 'api-llm',
  },
  {
    kind: 'ret',
    label: 'return',
    text: (
      <>
        <b>data</b> &larr; 6 hotels · reason
      </>
    ),
    ms: 600,
    tok: 320,
    node: 'tool',
    edge: 'tool-llm',
  },
  {
    kind: 'inject',
    label: 'skill ↳',
    text: (
      <>
        skill activates &rarr; adds <b>book_hold</b> tool
      </>
    ),
    ms: 90,
    tok: 70,
    node: 'tool',
    edge: 'ctx-tool',
  },
  {
    kind: 'ask',
    label: 'ask',
    text: (
      <>
        call <b>book_hold</b>({'{ id: "baixa" }'})
      </>
    ),
    ms: 240,
    tok: 150,
    node: 'llm',
    edge: 'api-llm',
  },
  {
    kind: 'ret',
    label: 'return',
    text: (
      <>
        <b>instruction</b> &larr; needs sign-off · act
      </>
    ),
    ms: 520,
    tok: 210,
    node: 'tool',
    edge: 'tool-llm',
  },
  {
    kind: 'answer',
    label: 'answer',
    text: <>&ldquo;Hotel Baixa held &mdash; pending approval.&rdquo;</>,
    ms: 240,
    tok: 160,
    node: 'final',
    edge: 'route-final',
  },
  {
    kind: 'loop',
    label: 'loop ↻',
    text: 'every inject decision recorded to the footprint',
    ms: 0,
    tok: 0,
    node: 'tc',
    edge: 'loop',
  },
];

type FlowNode = { id: NodeId; nt: string; ns?: string; x: number; y: number; cls?: string; flavor?: string };
const NODES: FlowNode[] = [
  { id: 'ctx', nt: 'Context', ns: 'ReAct loop', x: 50, y: 11 },
  { id: 'sys', nt: 'System Prompt', x: 18, y: 30, cls: 'pill', flavor: 'coral' },
  { id: 'msg', nt: 'Messages', x: 50, y: 30, cls: 'pill', flavor: 'purple' },
  { id: 'tool', nt: 'Tools', x: 82, y: 30, cls: 'pill', flavor: 'teal' },
  { id: 'api', nt: 'messageAPI', ns: 'assemble', x: 50, y: 50.5 },
  { id: 'llm', nt: 'CallLLM', ns: 'send request', x: 50, y: 69.5 },
  { id: 'route', nt: 'Route', ns: 'route', x: 50, y: 86.5, cls: 'diamond' },
  { id: 'final', nt: 'Final', ns: 'answer', x: 25, y: 92 },
  { id: 'tc', nt: 'ToolCalls', ns: 'execute', x: 75, y: 92 },
];

const EDGES: { id: EdgeId; d: string; loop?: boolean }[] = [
  { id: 'ctx-sys', d: 'M50,11 L20.2,11 Q18,11 18,15.5 L18,30' },
  { id: 'ctx-msg', d: 'M50,11 L50,30' },
  { id: 'ctx-tool', d: 'M50,11 L79.8,11 Q82,11 82,15.5 L82,30' },
  { id: 'sys-api', d: 'M18,30 L18,46 Q18,50.5 20.2,50.5 L50,50.5' },
  { id: 'msg-api', d: 'M50,30 L50,50.5' },
  { id: 'api-llm', d: 'M50,50.5 L50,69.5' },
  { id: 'tool-llm', d: 'M82,30 L82,65 Q82,69.5 79.8,69.5 L50,69.5' },
  { id: 'llm-route', d: 'M50,69.5 L50,86.5' },
  { id: 'route-final', d: 'M50,86.5 L25,92' },
  { id: 'route-tc', d: 'M50,86.5 L75,92' },
  { id: 'loop', d: 'M75,92 L96,92 L96,7 L52,7', loop: true },
];

// Trace-event chips (layer B queue).
const CHIPS: { name: string; flavor: string }[] = [
  { name: 'onStageAdded', flavor: 'coral' },
  { name: 'onCommit', flavor: 'purple' },
  { name: 'onDecision', flavor: 'teal' },
  { name: 'onEmit', flavor: 'amber' },
];

// Scroll-phase captions under the card.
const PHASES: React.ReactNode[] = [
  <>
    The agent runs &mdash; every event drains into a typed log, <b>one row per step.</b>
  </>,
  <>
    Same recorded run, <b>other lens</b> &rarr; the stage queues its trace events as it executes.
  </>,
  <>
    In the <b>idle beat</b> the dispatcher flushes the queue &mdash; <b>off the hot path.</b>
  </>,
  <>
    Listeners &amp; trace memory fill <b>one beat behind</b> &mdash; the run pays <b>nothing.</b>
  </>,
];

export function CoreEngine() {
  // Layer A — live drain log state.
  const [emitted, setEmitted] = useState<number>(0); // count of STEPS appended so far
  const [tally, setTally] = useState({ ms: 0, tok: 0, steps: 0 });
  const logScrollRef = useRef<HTMLDivElement>(null);

  // Layer B — scroll-driven cross-fade + dispatch state.
  const [prog, setProg] = useState(0); // 0..1 progress through the pin
  const pinRef = useRef<HTMLDivElement>(null);

  const reduced =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  // ---- Layer A: replay the recorded run on a timer, gated by IntersectionObserver ----
  useEffect(() => {
    const host = logScrollRef.current;
    if (!host) return;

    if (reduced) {
      // Final state: show the full footprint, no timers.
      setEmitted(STEPS.length);
      const tot = STEPS.reduce(
        (a, s) => (s.kind === 'loop' ? a : { ms: a.ms + s.ms, tok: a.tok + s.tok, steps: a.steps + 1 }),
        { ms: 0, tok: 0, steps: 0 },
      );
      setTally(tot);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let started = false;
    let i = 0;
    let acc = { ms: 0, tok: 0, steps: 0 };

    const step = () => {
      const s = STEPS[i];
      i += 1;
      setEmitted(i);
      if (s.kind !== 'loop') {
        acc = { ms: acc.ms + s.ms, tok: acc.tok + s.tok, steps: acc.steps + 1 };
        setTally({ ...acc });
      }
      // auto-scroll the log to the newest row
      const el = logScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;

      if (i >= STEPS.length) {
        // hold the full footprint, then reset for the next loop
        timer = setTimeout(() => {
          i = 0;
          acc = { ms: 0, tok: 0, steps: 0 };
          setEmitted(0);
          setTally({ ms: 0, tok: 0, steps: 0 });
          timer = setTimeout(step, 700);
        }, 2600);
        return;
      }
      timer = setTimeout(step, 700);
    };

    const start = () => {
      if (started) return;
      started = true;
      timer = setTimeout(step, 400);
    };

    let io: IntersectionObserver | undefined;
    try {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              start();
              io?.disconnect();
            }
          });
        },
        { threshold: 0.3 },
      );
      io.observe(host);
    } catch {
      /* no IO support — fall through to the fallback timer */
    }
    const fallback = setTimeout(start, 1500);

    return () => {
      if (timer) clearTimeout(timer);
      clearTimeout(fallback);
      io?.disconnect();
    };
  }, [reduced]);

  // ---- Layer B: scroll-driven progress through the pin ----
  useEffect(() => {
    if (reduced) {
      setProg(1);
      return;
    }
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const pin = pinRef.current;
        if (!pin) return;
        const rect = pin.getBoundingClientRect();
        const total = pin.offsetHeight - window.innerHeight;
        const p = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
        setProg(p);
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
  }, [reduced]);

  // ---- derive view state from progress ----
  const toEvt = prog > 0.48;
  // sub-progress within the dispatch half (after the cross-fade)
  const sub = prog < 0.55 ? 0 : Math.min(1, (prog - 0.55) / 0.45);
  const phaseIdx = prog < 0.42 ? 0 : prog < 0.55 ? 1 : sub < 0.5 ? 2 : 3;

  // dispatch animation: queue fills first, then flushes; listeners light one beat behind.
  const dp = toEvt ? sub : 0;
  const nQueued = Math.min(CHIPS.length, Math.floor(dp * 6));
  const nFlushed = Math.max(0, Math.min(CHIPS.length, Math.floor((dp - 0.45) * 8)));
  const beating = dp > 0.4;
  const memLit = nFlushed >= CHIPS.length;

  // which nodes/edges are lit, and per-node hit counts (from the drain log)
  const litNodes = new Set<NodeId>();
  const litEdges = new Set<EdgeId>();
  const counts: Partial<Record<NodeId, number>> = {};
  for (let k = 0; k < emitted; k++) {
    const s = STEPS[k];
    litNodes.add(s.node);
    counts[s.node] = (counts[s.node] ?? 0) + 1;
    if (s.edge) litEdges.add(s.edge);
  }

  return (
    <div className="af-eng">
      {/* ---------- HERO ---------- */}
      <section className="af-eng-hero">
        <p className="af-eng-eyebrow">03 · the core engine</p>
        <h1 className="af-eng-h1">
          The brain thinks, asks a tool, <em>loops to the answer.</em>
        </h1>
        <p className="af-eng-lede">
          Every step is emitted as it happens &mdash; no instrumentation, no backtracking yet.
          agentfootprint just records the real flow as the loop runs.
        </p>

        <div className="af-eng-mental">
          <svg viewBox="0 0 1160 380" role="img" className="af-eng-mental-svg">
            <title>
              The brain thinks, asks a tool, and gets back data (reason), an instruction (act), or
              both, looping to the answer.
            </title>
            <defs>
              <linearGradient id="afEngBrain" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#E68A52" />
                <stop offset="1" stopColor="#C0531F" />
              </linearGradient>
            </defs>
            <g fill="none" strokeLinecap="round">
              <path className="af-eng-flow" d="M232 196 Q305 256 376 200" stroke="#A8906E" strokeWidth="2.4" />
              <path d="M372 205 l8 -7 l-2 10 Z" fill="#A8906E" stroke="none" />
              <path className="af-eng-flow" d="M376 142 Q305 84 234 146" stroke="#6E5C49" strokeWidth="2.4" />
              <path d="M238 142 l-8 7 l2 -10 Z" fill="#6E5C49" stroke="none" />
            </g>
            <text x="305" y="250" className="af-eng-tag" textAnchor="middle">
              asks for what it&rsquo;s missing
            </text>
            <text x="305" y="100" className="af-eng-tag" textAnchor="middle">
              tool replies
            </text>
            <g transform="translate(111 118) scale(1.05)">
              <g className="af-eng-brn">
                <path
                  d="M56 9 C64 3 77 5 81 14 C92 11 101 20 97 31 C105 36 106 48 97 54 C103 63 98 74 88 75 C85 85 73 89 65 82 C61 88 51 88 47 82 C39 89 27 85 24 75 C14 74 9 63 15 54 C6 48 7 36 15 31 C11 20 20 11 31 14 C35 5 48 3 56 9 Z"
                  fill="url(#afEngBrain)"
                  stroke="#FBF6EC"
                  strokeWidth="3"
                  strokeLinejoin="round"
                />
                <g fill="#2C1F15">
                  <circle cx="47" cy="46" r="5.5" />
                  <circle cx="65" cy="46" r="5.5" />
                </g>
                <path d="M50 60 q6 6 12 0" fill="none" stroke="#2C1F15" strokeWidth="3" strokeLinecap="round" />
              </g>
            </g>
            <text x="170" y="262" className="af-eng-nm" textAnchor="middle">
              LLM brain
            </text>
            <g>
              <rect x="382" y="132" width="96" height="74" rx="13" fill="#F4EBDB" stroke="#E6D8C2" strokeWidth="1.5" />
              <rect x="382" y="132" width="96" height="22" rx="11" fill="#E6D8C2" />
              <rect x="420" y="126" width="20" height="9" rx="4" fill="#6E5C49" />
              <g fill="#A8906E">
                <rect x="402" y="170" width="9" height="22" rx="2" />
                <rect x="425" y="170" width="9" height="22" rx="2" />
                <rect x="448" y="170" width="9" height="22" rx="2" />
              </g>
            </g>
            <text x="430" y="262" className="af-eng-nm" textAnchor="middle">
              tools
            </text>
            <g fill="none" stroke="#6E5C49" strokeLinecap="round">
              <path className="af-eng-flow" d="M486 190 H534" strokeWidth="2.2" />
              <path d="M540 118 V262" strokeWidth="2" opacity=".5" />
              <path d="M534 190 H540 M540 116 H558 M540 190 H558 M540 264 H558" strokeWidth="2" opacity=".5" />
            </g>
            <text x="560" y="74" className="af-eng-tag">
              a tool reply is one of &mdash;
            </text>
            <g className="af-eng-r1">
              <rect x="560" y="88" width="360" height="56" rx="28" fill="#DCF0ED" stroke="#E6D8C2" strokeWidth="1.5" />
              <circle cx="588" cy="116" r="17" fill="#0E8A82" />
              <text x="620" y="117" className="af-eng-lbl" dominantBaseline="middle">
                data
              </text>
              <text x="904" y="117" className="af-eng-sub" textAnchor="end" dominantBaseline="middle">
                &rarr; reason
              </text>
            </g>
            <g className="af-eng-r2">
              <rect x="560" y="162" width="360" height="56" rx="28" fill="#F8EBCC" stroke="#E6D8C2" strokeWidth="1.5" />
              <circle cx="588" cy="190" r="17" fill="#C98512" />
              <text x="620" y="191" className="af-eng-lbl" dominantBaseline="middle">
                instruction
              </text>
              <text x="904" y="191" className="af-eng-sub" textAnchor="end" dominantBaseline="middle">
                &rarr; act · skill / steering
              </text>
            </g>
            <g className="af-eng-r3">
              <rect x="560" y="236" width="360" height="56" rx="28" fill="#F4EBDB" stroke="#E6D8C2" strokeWidth="1.5" />
              <circle cx="588" cy="264" r="17" fill="#0E8A82" />
              <path d="M571 264 a17 17 0 0 1 34 0 Z" fill="#C98512" />
              <text x="624" y="265" className="af-eng-lbl" dominantBaseline="middle">
                data + instruction
              </text>
              <text x="904" y="265" className="af-eng-sub" textAnchor="end" dominantBaseline="middle">
                &rarr; both
              </text>
            </g>
            <g fill="none" strokeLinecap="round">
              <path className="af-eng-flow" d="M924 190 H986" stroke="#3E9B4F" strokeWidth="2.4" />
              <path d="M982 185 l8 5 l-8 5 Z" fill="#3E9B4F" stroke="none" />
            </g>
            <g className="af-eng-ansr">
              <circle cx="1044" cy="190" r="36" fill="#3E9B4F" />
              <path
                d="M1029 191 l10 10 l20 -22"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
            <text x="1044" y="250" className="af-eng-nm" textAnchor="middle" fill="#2C7339">
              answer
            </text>
            <text x="580" y="336" className="af-eng-cap" textAnchor="middle">
              The brain thinks · asks a tool · gets{' '}
              <tspan fill="#0A6660" fontWeight="700">
                data
              </tspan>{' '}
              (reason), an{' '}
              <tspan fill="#9A6306" fontWeight="700">
                instruction
              </tspan>{' '}
              (act), or both · loops to the answer.
            </text>
          </svg>
        </div>
      </section>

      {/* ---------- THE RECORDING BLOCK (scroll-pinned cross-fade) ---------- */}
      <section className="af-eng-block">
        <div className="af-eng-pin" ref={pinRef}>
          <div className="af-eng-sticky">
            {/* sticky headline cross-fade */}
            <div className={`af-eng-headline${toEvt ? ' to-evt' : ''}`}>
              <div className="af-eng-hl-a">
                <h2 className="af-eng-h2">
                  The loop <em>records itself.</em>
                </h2>
                <p className="af-eng-block-lede">
                  As the agent runs, every event drains into a typed log &mdash;{' '}
                  <b>prompt · ask · return · answer</b> &mdash; with its own cost. This is the footprint
                  you&rsquo;ll later walk backward.
                </p>
              </div>
              <div className="af-eng-hl-b">
                <h2 className="af-eng-h2">
                  And it costs the run <em>nothing.</em>
                </h2>
                <p className="af-eng-block-lede">
                  Same recorded run &mdash; your agent <b>is</b> the event loop. The stage queues its
                  trace events; the <b>idle beat</b> flushes them to your listeners and trace memory,{' '}
                  <b>one beat behind</b>, never blocking the hot path.
                </p>
              </div>
            </div>

            <div className="af-eng-split af-eng-flowwrap">
              {/* LEFT — the constant execution flowchart */}
              <div className="af-eng-exec-card">
                <div className="af-eng-card-head">
                  <span className="af-eng-card-label">execution</span>
                  <span className="af-eng-card-sub">ReAct loop · the hot path</span>
                </div>
                <div className="af-eng-flow-host">
                  <div className="af-eng-flow">
                    <svg className="af-eng-fedges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                      {EDGES.map((ed) => (
                        <path
                          key={ed.id}
                          d={ed.d}
                          className={`af-eng-fe${ed.loop ? ' loop' : ''}${litEdges.has(ed.id) ? ' lit' : ''}`}
                        />
                      ))}
                    </svg>
                    {NODES.map((nd) => {
                      const lit = litNodes.has(nd.id);
                      const c = counts[nd.id];
                      const cls = ['af-eng-fnode', nd.cls || '', lit ? 'lit' : ''].join(' ').trim();
                      return (
                        <div
                          key={nd.id}
                          className={cls}
                          data-flavor={nd.flavor}
                          style={{ left: `${nd.x}%`, top: `${nd.y}%` }}
                        >
                          {nd.cls === 'pill' ? (
                            <>
                              <span className="af-eng-dot" />
                              {nd.nt}
                            </>
                          ) : (
                            <>
                              <b>{nd.nt}</b>
                              {nd.ns && <span>{nd.ns}</span>}
                            </>
                          )}
                          {lit && c ? <i className="af-eng-fcount">{c}</i> : null}
                        </div>
                      );
                    })}
                    <i className="af-eng-loop-arrow" aria-hidden="true" />
                  </div>
                </div>
              </div>

              {/* RIGHT — log (layer A) cross-fades to dispatch (layer B) */}
              <div className="af-eng-rec-card">
                <div className="af-eng-rec-head">
                  <span className="af-eng-live">
                    <span className="af-eng-blink-dot" />
                    recording
                  </span>
                  <span className="af-eng-rec-tally">
                    <b>{tally.ms.toLocaleString()}</b> ms · <b>{tally.tok.toLocaleString()}</b> tok ·{' '}
                    <b>{tally.steps}</b> steps
                  </span>
                </div>

                <div className={`af-eng-rec-right${toEvt ? ' to-evt' : ''}`}>
                  {/* layer A — the drain log */}
                  <div className="af-eng-rec-log" ref={logScrollRef}>
                    {STEPS.slice(0, emitted).map((s, idx) => {
                      // running 1-based index that skips the loop pseudo-row
                      const nodeNum = STEPS.slice(0, idx + 1).filter((x) => x.kind !== 'loop').length;
                      return (
                        <div key={idx} className={`af-eng-ln ${s.kind}`}>
                          <span className="af-eng-ln-node">{s.kind === 'loop' ? '↻' : nodeNum}</span>
                          <span className="af-eng-ln-kind">{s.label}</span>
                          <span className="af-eng-ln-txt">{s.text}</span>
                          {s.ms ? (
                            <span className="af-eng-ln-meta">
                              {s.ms}ms · {s.tok}tok
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  {/* layer B — the idle-beat dispatch runtime */}
                  <div className="af-eng-dispatch" aria-hidden={!toEvt}>
                    <div className="af-eng-dsp-cap">the runtime · idle-beat dispatch</div>
                    <div className="af-eng-dsp-stack">
                      <span className={`af-eng-dsp-ring${toEvt ? ' spin' : ''}`} aria-hidden="true" />
                      <span className="af-eng-tagi">call stack</span>
                      <span className="af-eng-dsp-stack-sub">stage runs — hot path · 16ms tick</span>
                    </div>
                    <div className="af-eng-dsp-rail">
                      <span className={`af-eng-dsp-drop${toEvt ? ' run' : ''}`} />
                    </div>
                    <div className="af-eng-dsp-queue">
                      {CHIPS.map((chip, idx) => (
                        <div
                          key={chip.name}
                          className={`af-eng-dsp-chip${idx < nQueued ? ' queued' : ''}${
                            idx < nFlushed ? ' flushed' : ''
                          }`}
                          data-flavor={chip.flavor}
                        >
                          <span className="af-eng-ev" />
                          <b>{chip.name}</b>
                        </div>
                      ))}
                    </div>
                    <div className={`af-eng-dsp-idle${beating ? ' beating' : ''}`}>
                      <span className="af-eng-spin">⟳</span> idle beat flushes the queue
                    </div>
                    <div className="af-eng-dsp-fan" aria-hidden="true">
                      <span />
                      <span />
                    </div>
                    <div className="af-eng-dsp-out">
                      <div className="af-eng-dsp-listeners">
                        {CHIPS.map((chip, idx) => (
                          <div
                            key={chip.name}
                            className={`af-eng-dsp-lst${idx < Math.max(0, nFlushed - 1) ? ' lit' : ''}`}
                          >
                            <i className={`af-eng-dot-${chip.flavor}`} />
                            listener
                          </div>
                        ))}
                      </div>
                      <div className={`af-eng-dsp-mem${memLit ? ' lit' : ''}`}>
                        <span className="af-eng-dsp-mem-t">trace memory</span>
                        <span className="af-eng-dsp-mem-tl">
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="af-eng-rec-foot">
                  ↳ logs collect <b>as we run</b> and connect <b>as they execute</b> &mdash; and it&rsquo;s{' '}
                  <b>free</b>: the footprint drains on the event loop&rsquo;s <b>idle time</b>, off the
                  agent&rsquo;s critical path. Zero added latency.
                </div>
              </div>
            </div>

            <p className="af-eng-rec-phase">
              <span className="a">{PHASES[phaseIdx]}</span>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
