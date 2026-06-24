'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Chapter 1, beat 3 — "Why this tool?" (ported from the shared backtrack-story design).
 * Two-step, scroll-pinned: step 1 the agent canvas shows a "Why this tool?" button with
 * the inspector hidden; CLICK it (or scroll past) to reveal the Step Inspector; then
 * SCROLL cycles the scorers (embedding → attention → learned-probe / BYO). Embedding
 * ties search_hotels and load_skill at 0.50; the Description Doctor (left, under the
 * canvas) rewrites the tool's description on a button click — breaking the tie on both
 * sides. agentfootprint owns the detection; you own the policy.
 */

type ToolId = 'hold' | 'hotels' | 'skill' | 'flights';
type ScorerId = 'embed' | 'attn' | 'learned';

const SCORERS: Record<ScorerId, Record<ToolId, number>> = {
  embed: { hold: 100, hotels: 50, skill: 50, flights: 0 },
  attn: { hold: 62, hotels: 78, skill: 40, flights: 14 },
  learned: { hold: 35, hotels: 88, skill: 22, flights: 6 },
};
const SHARPENED: Record<ToolId, number> = { hold: 100, hotels: 90, skill: 20, flights: 0 };

const TOOLS: { id: ToolId; icon: string; name: string }[] = [
  { id: 'flights', icon: '✈', name: 'search_flights' },
  { id: 'hotels', icon: '⌂', name: 'search_hotels' },
  { id: 'hold', icon: '▣', name: 'book_hold' },
  { id: 'skill', icon: '≡', name: 'load_skill' },
];
const ROWS: { id: ToolId; name: string; picked?: boolean }[] = [
  { id: 'hold', name: 'book_hold' },
  { id: 'hotels', name: 'search_hotels', picked: true },
  { id: 'skill', name: 'load_skill' },
  { id: 'flights', name: 'search_flights' },
];
const SCORER_OPTS: { id: ScorerId; label: string; sub: string; phase: number }[] = [
  { id: 'embed', label: 'embedding', sub: 'cheap · default', phase: 3 },
  { id: 'attn', label: 'attention', sub: 'model-internal', phase: 4 },
  { id: 'learned', label: 'learned-probe', sub: 'BYO scorer', phase: 5 },
];
const NAME: Record<ToolId, string> = {
  hold: 'book_hold',
  hotels: 'search_hotels',
  skill: 'load_skill',
  flights: 'search_flights',
};

// 6 scroll beats: 0 prompt, 1 scores (tie), 2 sharpen, 3 scorer menu, 4 attention, 5 learned-probe.
const CAPS: ReactNode[] = [
  <>
    The agent picked <b>search_hotels</b> by its description. So — <b>why this tool?</b>
  </>,
  <>
    Relevance scores them by term-match — but <b>search_hotels</b> ties <b>load_skill</b> at 0.50. An
    ambiguous tie, a misfire waiting to happen.
  </>,
  <>
    Tie broken — your LLM&rsquo;s <b>rewrite</b> pushes <b>search_hotels</b> to 0.90 over{' '}
    <b>load_skill</b> 0.20. agentfootprint only flagged the tie.
  </>,
  <>
    Or fix it another way: <b>what scores them?</b> The cheap <b>embedding</b> proxy is what tied them
    — and you can swap it.
  </>,
  <>
    Swap to <b>attention</b> — it reads the model&rsquo;s own internals and re-ranks decisively.
  </>,
  <>
    Or a <b>learned probe</b> trained on your model — <b>bring your own</b> scorer.
  </>,
];
const LAST = CAPS.length - 1;

export function WhyThisTool() {
  const [phase, setPhase] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  // scroll-driven scrubbing
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

  const goToPhase = (k: number) => {
    const track = trackRef.current;
    if (!track) return;
    const target = Math.max(0, Math.min(LAST, k));
    const total = track.offsetHeight - window.innerHeight;
    const top = track.getBoundingClientRect().top + window.scrollY;
    const p = (target + 0.5) / (LAST + 1);
    window.scrollTo({ top: top + p * total, behavior: 'smooth' });
  };

  // fully scroll-driven, progressive panels:
  // 1 = scores (tie), 2 = sharpen (tie broken), 3 = scorer menu (embedding baseline),
  // 4 = swap to attention, 5 = learned-probe
  const revealed = phase >= 1;
  const scorer: ScorerId = phase >= 5 ? 'learned' : phase === 4 ? 'attn' : 'embed';
  const sharpened = phase === 2;
  const canFix = scorer === 'embed';
  const vals = sharpened ? SHARPENED : SCORERS[scorer];
  const isTie = canFix && !sharpened;
  const lead: ToolId = sharpened
    ? 'hotels'
    : (Object.keys(vals) as ToolId[]).reduce((a, b) => (vals[b] > vals[a] ? b : a));

  const ambiguity = isTie
    ? '⚠ ambiguous — search_hotels and load_skill tie at 0.50. A misfire waiting to happen.'
    : sharpened
      ? '✓ tie broken — search_hotels 0.90 vs load_skill 0.20 after the rewrite.'
      : `✓ decisive — ${NAME[lead]} leads clearly under this scorer.`;

  const cap = CAPS[phase];

  return (
    <section data-narrative="why this tool?" className={`af-why af-flowwrap${revealed ? ' is-revealed' : ''}`}>
      <p className="af-why-kicker">Same machinery, a different agent</p>
      <h2 className="af-why-head">Why this tool?</h2>
      <p className="af-why-lede">
        Backtracking proved <i>why a past run broke.</i> The same recorded panel works <b>forward</b>{' '}
        too — a travel agent picks one of <b>4 tools</b> by their <b>descriptions.</b>{' '}
        <b>Scroll to reveal the scores, sharpen the tie, then swap scorers.</b>
      </p>

      <div className="af-why-track" ref={trackRef}>
        <div className="af-why-stage">
          <div className="af-why-grid">
            {/* LEFT — agent canvas, then (once revealed) the Description Doctor */}
            <div className="af-why-left">
              <div className="af-agent-pane">
                <div className="af-brain-col">
                  <div className="af-think">
                    <span className="th-h">thinking</span>
                    <span className="th-dots">•••</span>
                  </div>
                  <svg className="af-brain" viewBox="0 0 80 80" aria-hidden="true">
                    <circle className="r-ant" cx="40" cy="9" r="3.4" />
                    <line className="r-stem" x1="40" y1="12" x2="40" y2="21" />
                    <rect className="r-head" x="15" y="21" width="50" height="44" rx="13" />
                    <circle className="r-eye" cx="31" cy="40" r="4.2" />
                    <circle className="r-eye" cx="49" cy="40" r="4.2" />
                    <path className="r-mouth" d="M31 53 H49" />
                  </svg>
                  <span className="af-brain-label">LLM</span>
                </div>

                <svg className="af-connect" viewBox="0 0 120 200" preserveAspectRatio="none" aria-hidden="true">
                  <path className="c-pick" d="M10,120 C55,110 72,72 104,74" />
                  <path className="c-pick-head" d="M117,74 l-15,-7 l0,14 z" />
                  <path className="c-offer" d="M104,116 C72,138 55,156 10,150" />
                  <text className="c-lbl" x="60" y="56">picks</text>
                </svg>

                <div className="af-tool-stack">
                  {TOOLS.map((t) => (
                    <div key={t.id} className={`af-ts-tool${t.id === 'hotels' ? ' picked' : ''}`}>
                      <span className="ti">{t.icon}</span>
                      {t.name}
                    </div>
                  ))}
                </div>

                {!revealed && (
                  <button type="button" className="af-why-btn" onClick={() => goToPhase(1)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                      <circle cx="11" cy="11" r="7" />
                      <path d="m21 21-4.3-4.3" strokeLinecap="round" />
                    </svg>
                    Why this tool?
                    <span className="af-nudge">click here</span>
                  </button>
                )}
              </div>

              {phase === 2 && (
                <div className={`af-why-fix${!canFix ? ' dim' : ''}`}>
                  <span className="af-ctrl-q">search_hotels — its description</span>
                  <div className={`af-desc-cur${sharpened ? ' struck' : ''}`}>
                    &ldquo;Find hotels in a city for a date range&rdquo;
                  </div>
                  <div className={`af-desc-new${sharpened ? ' show' : ''}`}>
                    &ldquo;Search hotels — reach for this ONLY when the task explicitly needs lodging,
                    not the adjacent booking step a sibling tool already covers.&rdquo;
                  </div>
                  <div className="af-fix-foot">
                    {canFix && !sharpened ? (
                      <button type="button" className="af-sharpen-btn" onClick={() => goToPhase(2)}>
                        Sharpen &amp; re-score
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                          <path d="M5 12h14M13 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    ) : (
                      <span className="af-fix-tag">
                        {sharpened ? '✓ rewritten — tie broken' : 'no tie under this scorer'}
                      </span>
                    )}
                    <p className="af-ctrl-note">
                      ↳ rewrite returned by <b>your</b> LLM · agentfootprint only flagged the tie
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT — progressive reveal: scores (beat 1) → scorer pills (beat 3) */}
            <div className="af-score-pane">
              {phase >= 3 && (
              <div className="af-ctrl">
                <span className="af-ctrl-q">What scores them?</span>
                <div className="af-scorer-row">
                  {SCORER_OPTS.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className="af-scorer-opt"
                      aria-pressed={scorer === o.id}
                      onClick={() => goToPhase(o.phase)}
                    >
                      {o.label}
                      <span className="sub">{o.sub}</span>
                    </button>
                  ))}
                </div>
                <p className="af-ctrl-note">
                  Scroll to swap the scorer — the ranking re-orders over the same graph.{' '}
                  <b>You plug your own.</b>
                </p>
              </div>
              )}

              {phase >= 1 && (
              <div className="af-relpanel">
                <div className="insp-head">
                  <span className="insp-q">🔍 why this tool?</span>
                </div>
                <p className="af-rel-sub">
                  relevance — term match with the task (a proxy, not the model&rsquo;s own reason)
                </p>
                {ROWS.map((r) => {
                  const v = vals[r.id];
                  const cls = isTie && (r.id === 'hotels' || r.id === 'skill') ? ' tie' : !isTie && r.id === lead ? ' lead' : '';
                  return (
                    <div key={r.id} className={`af-relrow${cls}${r.picked ? ' picked' : ''}`}>
                      <span className="nm">
                        {r.name}
                        {r.picked && <span className="pk">picked</span>}
                      </span>
                      <span className="track">
                        <span className="fill" style={{ width: `${v}%` }} />
                      </span>
                      <span className="pct">{(v / 100).toFixed(2)}</span>
                    </div>
                  );
                })}
                <p className="af-matched">
                  matched: <b>hotel</b>
                </p>
                <p className={`af-ambiguity${!isTie ? ' resolved' : ''}`}>{ambiguity}</p>
              </div>
              )}
            </div>
          </div>

          <p className="af-why-cap">{cap}</p>
          <div className="af-why-rail" aria-hidden="true">
            {CAPS.map((_, i) => (
              <i key={i} className={i <= phase ? 'on' : ''} />
            ))}
          </div>
        </div>
      </div>

      <p className="af-why-foot">
        agentfootprint owns the <b>detection</b> — the scores, the ties, the recorded graph. You own
        the <b>policy</b> — the scorer, the rewriter. We map; you decide.
      </p>
    </section>
  );
}
