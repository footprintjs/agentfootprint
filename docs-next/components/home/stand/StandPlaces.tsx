'use client';

import { useRef, type CSSProperties } from 'react';
import { at, useInView } from './StandStages';

const PLACES = [
  { id: 'place-call', step: '1', name: 'Calling a tool', what: 'What the model sends.' },
  { id: 'place-read', step: '2', name: 'Reading a result', what: 'What comes back.' },
  { id: 'place-answer', step: '3', name: 'Giving the answer', what: 'What the model claims.' },
] as const;

/** One small scene per place, on the same refund as the film. Decorative, and timed by CSS. */
function PlaceArt({ id }: { id: string }) {
  if (id === 'place-call') {
    return (
      <svg viewBox="0 0 200 72" aria-hidden="true">
        <path className="la-wire" pathLength={1} d="M46 36H62" style={at(0)} />
        <path className="la-wire" pathLength={1} d="M126 36H154" style={at(2)} />
        <g className="la-pop" style={at(0)}>
          <rect className="la-node" x={0} y={22} width={46} height={28} rx={7} />
          <text x={23} y={39}>
            model
          </text>
        </g>
        <g className="la-pop" style={at(1)}>
          <rect className="la-node la-flash" x={62} y={22} width={64} height={28} rx={7} style={at(1)} />
          <text x={94} y={39}>
            A-1042
          </text>
        </g>
        <rect className="la-gate" x={138} y={14} width={3} height={44} rx={1.5} />
        <g className="la-pop" style={at(3)}>
          <rect className="la-node" x={154} y={22} width={46} height={28} rx={7} />
          <text x={177} y={39}>
            tool
          </text>
        </g>
      </svg>
    );
  }
  if (id === 'place-read') {
    return (
      <svg viewBox="0 0 200 72" aria-hidden="true">
        <path className="la-wire" pathLength={1} d="M46 36H66" style={at(0)} />
        <g className="la-pop" style={at(0)}>
          <rect className="la-node" x={0} y={22} width={46} height={28} rx={7} />
          <text x={23} y={39}>
            tool
          </text>
        </g>
        <g className="la-pop" style={at(1)}>
          <rect className="la-node la-flash" x={66} y={8} width={134} height={26} rx={6} style={at(1)} />
          <text x={133} y={24}>
            status: pending
          </text>
        </g>
        <g className="la-pop" style={at(2)}>
          <rect className="la-node la-dash" x={66} y={38} width={134} height={26} rx={6} />
          <text x={133} y={54}>
            not checked: card reports
          </text>
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 200 72" aria-hidden="true">
      <path className="la-wire la-red" pathLength={1} d="M86 36H114" style={at(1)} />
      <g className="la-pop" style={at(0)}>
        <rect className="la-node" x={0} y={18} width={86} height={36} rx={7} />
        <text x={43} y={33}>
          said
        </text>
        <text className="la-strong-ink" x={43} y={46}>
          completed
        </text>
      </g>
      <g className="la-pop" style={at(1)}>
        <rect className="la-node la-flash" x={114} y={18} width={86} height={36} rx={7} style={at(1)} />
        <text x={157} y={33}>
          holds
        </text>
        <text className="la-strong-ink" x={157} y={46}>
          pending
        </text>
      </g>
    </svg>
  );
}

/** Where the model is involved: three stops on one thread, each linking to its checks below. */
export function StandPlaces() {
  const root = useRef<HTMLElement>(null);
  const { seen, running } = useInView(root);
  return (
    <nav ref={root} className={`ls ls-3${running ? ' is-in' : ''}`} aria-label="The three places a model is involved">
      <div className="ls-track">
        <i className="ls-thread" aria-hidden="true">
          <b />
        </i>
        <i className="ls-spark" aria-hidden="true" />
        <ol>
          {PLACES.map((place, i) => (
            <li style={{ '--i': i } as CSSProperties} key={place.id}>
              <a href={`#${place.id}`}>
                <span>{place.step}</span>
                <strong>{place.name}</strong>
                <div className="ls-art">{seen ? <PlaceArt id={place.id} /> : null}</div>
                <small>{place.what}</small>
              </a>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
