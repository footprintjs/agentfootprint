'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Chapter 3 — "The engine". A clean flowchart scrollytelling (like the backtrack chapter): the same
 * ReAct loop that RECORDS ITSELF, walked in three discrete scroll beats —
 *   0  attach a recorder (born tracked, no instrumentation)
 *   1  what tracking buys you — four questions plain logs can't answer (real recorded runs)
 *   2  …and it costs the run nothing — idle-beat dispatch, one beat behind, off the hot path
 * The hero mental-model SVG and the event-loop dispatch visual are preserved.
 */

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

// Trace-event chips — the idle-beat dispatch queue.
const CHIPS: { name: string; flavor: string }[] = [
  { name: 'onStageAdded', flavor: 'coral' },
  { name: 'onCommit', flavor: 'purple' },
  { name: 'onDecision', flavor: 'teal' },
  { name: 'onEmit', flavor: 'amber' },
];

// ---- beat content ----
const ATTACH_CODE = `agent
  .attach(recorder())   // one line — it rides along
  .run({ message });    // every step captured, born tracked`;

type QA = { q: React.ReactNode; a: React.ReactNode; src: string };
// "What tracking buys you" — README's four questions logs can't answer, each from a real recorded run.
const QUESTIONS: QA[] = [
  {
    q: (
      <>
        Why <b>this</b> tool, not that one?
      </>
    ),
    a: (
      <>
        margin <b>0.02</b> &middot; <b>⚠ NARROW</b> — the two descriptions read nearly identical
      </>
    ),
    src: 'toolChoiceRecorder',
  },
  {
    q: <>Why was this loan declined?</>,
    a: (
      <>
        decision ← <b>dti 0.52</b> ← monthlyDebt / income — every hop a real recorded edge
      </>
    ),
    src: 'decide() + causal slice',
  },
  {
    q: <>Which context made the answer wrong?</>,
    a: (
      <>
        <b>CAUSAL</b>: ablating <b>vip-override</b> flipped the outcome in 3/3 reruns
      </>
    ),
    src: 'localizeContextBug',
  },
  {
    q: <>Prove nobody edited this record.</>,
    a: (
      <>
        verifyAuditBundle → <b>brokenAt #16</b> — the tampered row, named
      </>
    ),
    src: 'hash-chained audit',
  },
];

const CAPTIONS: React.ReactNode[] = [
  <>
    Your agent <b>is</b> the event loop. Attach a recorder — one line — and every step is captured as
    it runs, <b>born tracked.</b>
  </>,
  <>
    Four questions plain logs can&rsquo;t answer — each the captured output of a real run in this repo,
    each a real recorded edge.
  </>,
  <>
    And the watching is <b>free</b>: events queue on the hot path, the <b>idle beat</b> flushes them —{' '}
    <b>one beat behind</b>, never blocking.
  </>,
];

export function CoreEngine() {
  const [phase, setPhase] = useState(0);
  const pinRef = useRef<HTMLDivElement>(null);
  const LAST = 2; // 0 attach · 1 what tracking buys you · 2 costs nothing

  const reduced =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  useEffect(() => {
    if (reduced) {
      setPhase(LAST);
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
  }, [reduced]);

  // the recorded loop is a constant lit backdrop on every beat
  const litNodes = new Set<NodeId>(NODES.map((n) => n.id));
  const litEdges = new Set<EdgeId>(EDGES.map((e) => e.id));
  const onEvt = phase >= 2;

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

      {/* ---------- THE FOOTPRINT (scroll-pinned, 3 beats) ---------- */}
      <section className="af-eng-block" data-narrative="what tracking buys you">
        <div className="af-eng-pin" ref={pinRef}>
          <div className="af-eng-sticky">
            <div className="af-eng-headline2">
              {phase === 0 ? (
                <>
                  <h2 className="af-eng-h2">
                    The loop <em>records itself.</em>
                  </h2>
                  <p className="af-eng-block-lede">
                    No instrumentation: attach a recorder and every stage, decision, write and emit is
                    captured as the loop runs — the footprint you&rsquo;ll later walk backward.
                  </p>
                </>
              ) : phase === 1 ? (
                <>
                  <h2 className="af-eng-h2">
                    What tracking <em>buys you.</em>
                  </h2>
                  <p className="af-eng-block-lede">
                    Four questions plain logs can&rsquo;t answer — each the captured output of a real
                    run in this repo.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="af-eng-h2">
                    And it costs the run <em>nothing.</em>
                  </h2>
                  <p className="af-eng-block-lede">
                    Your agent <b>is</b> the event loop. The stage queues its trace events; the{' '}
                    <b>idle beat</b> flushes them to your listeners and trace memory, <b>one beat
                    behind</b>, never blocking the hot path.
                  </p>
                </>
              )}
            </div>

            <div className="af-eng-split af-eng-flowwrap">
              {/* LEFT — the constant recorded flowchart */}
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
                        </div>
                      );
                    })}
                    <i className="af-eng-loop-arrow" aria-hidden="true" />
                  </div>
                </div>
              </div>

              {/* RIGHT — per beat: attach · what tracking buys you · idle-beat dispatch */}
              <div className="af-eng-rec-card">
                {phase === 0 ? (
                  <>
                    <div className="af-eng-rec-head">
                      <span className="af-eng-live">
                        <span className="af-eng-blink-dot" />
                        recording
                      </span>
                      <span className="af-eng-rec-tally">attach · 1 line</span>
                    </div>
                    <pre className="af-eng-attach-code">{ATTACH_CODE}</pre>
                    <div className="af-eng-rec-foot">
                      ↳ <b>born tracked</b> — no manual logging, no decorators. The footprint is a side
                      effect of the run.
                    </div>
                  </>
                ) : phase === 1 ? (
                  <>
                    <div className="af-eng-rec-head">
                      <span className="af-eng-live">
                        <span className="af-eng-blink-dot" />
                        why &gt; what
                      </span>
                      <span className="af-eng-rec-tally">4 answers logs can&rsquo;t give</span>
                    </div>
                    <div className="af-eng-buys">
                      {QUESTIONS.map((it, i) => (
                        <div className="af-eng-qa" key={i}>
                          <p className="af-eng-qa-q">{it.q}</p>
                          <p className="af-eng-qa-a">{it.a}</p>
                          <span className="af-eng-qa-src">{it.src}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="af-eng-rec-head">
                      <span className="af-eng-live">
                        <span className="af-eng-blink-dot" />
                        recording
                      </span>
                      <span className="af-eng-rec-tally">one beat behind · 0ms added</span>
                    </div>
                    <div className="af-eng-rec-right to-evt">
                      <div className="af-eng-dispatch">
                        <div className="af-eng-dsp-cap">the runtime · idle-beat dispatch</div>
                        <div className="af-eng-dsp-stack">
                          <span className={`af-eng-dsp-ring${onEvt ? ' spin' : ''}`} aria-hidden="true" />
                          <span className="af-eng-tagi">call stack</span>
                          <span className="af-eng-dsp-stack-sub">stage runs — hot path · 16ms tick</span>
                        </div>
                        <div className="af-eng-dsp-rail">
                          <span className={`af-eng-dsp-drop${onEvt ? ' run' : ''}`} />
                        </div>
                        <div className="af-eng-dsp-queue">
                          {CHIPS.map((chip) => (
                            <div
                              key={chip.name}
                              className={`af-eng-dsp-chip${onEvt ? ' queued flushed' : ''}`}
                              data-flavor={chip.flavor}
                            >
                              <span className="af-eng-ev" />
                              <b>{chip.name}</b>
                            </div>
                          ))}
                        </div>
                        <div className={`af-eng-dsp-idle${onEvt ? ' beating' : ''}`}>
                          <span className="af-eng-spin">⟳</span> idle beat flushes the queue
                        </div>
                        <div className="af-eng-dsp-fan" aria-hidden="true">
                          <span />
                          <span />
                        </div>
                        <div className="af-eng-dsp-out">
                          <div className="af-eng-dsp-listeners">
                            {CHIPS.map((chip) => (
                              <div key={chip.name} className={`af-eng-dsp-lst${onEvt ? ' lit' : ''}`}>
                                <i className={`af-eng-dot-${chip.flavor}`} />
                                listener
                              </div>
                            ))}
                          </div>
                          <div className={`af-eng-dsp-mem${onEvt ? ' lit' : ''}`}>
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
                      ↳ collect during traversal, off the agent&rsquo;s critical path. Zero added latency.
                    </div>
                  </>
                )}
              </div>
            </div>

            <p className="af-eng-rec-phase">
              <span className="a">{CAPTIONS[phase]}</span>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
