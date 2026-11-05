'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { STAGES } from './copy';

export const at = (k: number) => ({ '--k': k }) as CSSProperties;

/** Draws the art once it is near, and only runs its timers while it is on screen. */
export function useInView(root: React.RefObject<HTMLElement | null>) {
  const [seen, setSeen] = useState(false);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        setRunning(entry!.isIntersecting);
        if (entry!.isIntersecting) setSeen(true);
      },
      { rootMargin: '120px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [root]);
  return { seen, running };
}

/** Each stage's small scene. Decorative, and timed entirely by CSS. */
function StageArt({ id }: { id: string }) {
  if (id === 'build') {
    return (
      <svg viewBox="0 0 200 72" aria-hidden="true">
        <path className="la-wire" pathLength={1} d="M52 36H76" style={at(1)} />
        <path className="la-wire" pathLength={1} d="M124 36H148" style={at(2)} />
        {['tool', 'skill', 'agent'].map((label, i) => (
          <g className="la-pop" style={at(i)} key={label}>
            <rect className="la-node" x={4 + i * 72} y={22} width={48} height={28} rx={7} />
            <text x={28 + i * 72} y={39}>
              {label}
            </text>
          </g>
        ))}
      </svg>
    );
  }
  if (id === 'debug') {
    return (
      <svg viewBox="0 0 200 72" aria-hidden="true">
        <path className="la-line" d="M26 32H170" />
        {[0, 1, 2, 3].map((i) => (
          <rect className="la-node la-flash" x={8 + i * 48} y={19} width={36} height={26} rx={6} style={at(3 - i)} key={i} />
        ))}
        <circle className="la-back" cx={170} cy={32} r={4} />
        <text x={170} y={62}>
          answer
        </text>
        <text x={26} y={62}>
          notes
        </text>
      </svg>
    );
  }
  if (id === 'deploy') {
    return (
      <svg viewBox="0 0 200 72" aria-hidden="true">
        <path className="la-wire" pathLength={1} d="M80 28C66 28 64 16 50 16" style={at(0)} />
        <path className="la-wire" pathLength={1} d="M120 28C134 28 136 16 150 16" style={at(1)} />
        <path className="la-wire" pathLength={1} d="M80 44C66 44 64 56 50 56" style={at(2)} />
        <path className="la-wire" pathLength={1} d="M120 44C134 44 136 56 150 56" style={at(3)} />
        <rect className="la-core" x={80} y={21} width={40} height={30} rx={8} />
        <text className="la-strong" x={100} y={40}>
          AF
        </text>
        {[
          ['models', 0, 6],
          ['memory', 150, 6],
          ['storage', 0, 46],
          ['telemetry', 150, 46],
        ].map(([label, x, y], i) => (
          <g className="la-pop" style={at(i + 1)} key={label as string}>
            <rect className="la-node" x={x as number} y={y as number} width={50} height={20} rx={6} />
            <text x={(x as number) + 25} y={(y as number) + 13}>
              {label}
            </text>
          </g>
        ))}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 200 72" aria-hidden="true">
      <rect className="la-node" x={2} y={23} width={34} height={26} rx={6} />
      <text x={19} y={39}>
        run
      </text>
      <path className="la-line" d="M36 36H122" />
      {[0, 1, 2, 3].map((i) => (
        <circle className="la-flow" cx={38} cy={36} r={3} style={at(i)} key={i} />
      ))}
      {[18, 30, 22, 42, 34].map((h, i) => (
        <rect className="la-bar" x={124 + i * 15} y={62 - h} width={11} height={h} rx={2} style={at(i)} key={i} />
      ))}
    </svg>
  );
}

/**
 * The four stages as one thread. It takes its own place in the page and never
 * sticks, so it cannot sit on top of anything. A spark runs along the thread, and
 * each stage plays its scene as the spark arrives.
 */
export function StandStages() {
  const root = useRef<HTMLElement>(null);
  const { seen, running } = useInView(root);

  return (
    <nav
      ref={root}
      className={`ls${running ? ' is-in' : ''}`}
      aria-label="AgentFootprint developer stages and public APIs"
    >
      <div className="ls-track">
        <i className="ls-thread" aria-hidden="true">
          <b />
        </i>
        <i className="ls-spark" aria-hidden="true" />
        <ol>
          {STAGES.map((stage, i) => (
            <li style={{ '--i': i } as CSSProperties} key={stage.id}>
              <a href={`#${stage.id}`}>
                <span>{stage.step}</span>
                <strong>{stage.name}</strong>
                <div className="ls-art">{seen ? <StageArt id={stage.id} /> : null}</div>
                <small>{stage.what}</small>
                <div className="ls-apis" aria-label={`Core APIs: ${stage.apis.join(', ')}`}>
                  {stage.apis.map((api) => (
                    <code key={api}>
                      {api}
                      {stage.betaApis?.includes(api) ? <sup title="Beta">β</sup> : null}
                    </code>
                  ))}
                </div>
              </a>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}

/**
 * Where you are, as a thin bar. It sticks only inside its wrapper, so it stops
 * where Monitor stops. Links are plain anchors: a click jumps, then you scroll.
 */
export function StandStageBar() {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(STAGES[0]!.id);

  useEffect(() => {
    const bar = root.current;
    if (!bar) return;
    let raf = 0;
    const read = () => {
      const heads = STAGES.map((stage) => document.getElementById(stage.id)).filter((el): el is HTMLElement => el !== null);
      if (heads.length === 0) return;
      const line = bar.getBoundingClientRect().bottom + 8;
      const end = bar.parentElement!.getBoundingClientRect().bottom;
      let index = 0;
      heads.forEach((head, i) => {
        if (head.getBoundingClientRect().top <= line) index = i;
      });
      const from = heads[index]!.getBoundingClientRect().top;
      const to = heads[index + 1]?.getBoundingClientRect().top ?? end;
      const part = Math.min(1, Math.max(0, (line - from) / Math.max(1, to - from)));
      bar.style.setProperty('--p', String((index + part) / heads.length));
      setActive(STAGES[index]!.id);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <nav ref={root} className="ls-bar" aria-label="Stages, and where you are">
      <div>
        {STAGES.map((stage) => (
          <a
            href={`#${stage.id}`}
            className={stage.id === active ? 'is-on' : undefined}
            aria-current={stage.id === active ? 'true' : undefined}
            key={stage.id}
          >
            {stage.short}
          </a>
        ))}
        <i aria-hidden="true" />
      </div>
    </nav>
  );
}
