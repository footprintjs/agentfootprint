'use client';

import { NODE_SECTION } from './copy';

/** Why this runs on Node.js. A fit, stated with its limit. */
export function StandNode() {
  const s = NODE_SECTION;
  return (
    <section className="sn" aria-labelledby="sn-title">
      <div className="sn-ring" aria-hidden="true">
        <svg viewBox="0 0 240 240" role="presentation">
          <circle className="sn-track" cx="120" cy="120" r="92" />
          <circle className="sn-wait sn-wait-a" cx="120" cy="120" r="92" pathLength="100" />
          <circle className="sn-wait sn-wait-b" cx="120" cy="120" r="92" pathLength="100" />
          <circle className="sn-wait sn-wait-c" cx="120" cy="120" r="92" pathLength="100" />
          <g className="sn-spin">
            <circle cx="120" cy="28" r="8" />
          </g>
          <text x="120" y="112" textAnchor="middle">event loop</text>
          <text x="120" y="134" textAnchor="middle" className="sn-sub">model · tool · screen</text>
        </svg>
      </div>
      <div className="sn-body">
        <p className="v2-kicker">{s.kicker}</p>
        <h2 id="sn-title">{s.title}</h2>
        <p className="sn-lede">
          {s.lede} <a href={s.source}>Node.js describes itself</a> as designed for scalable network applications.
        </p>
        <ul>
          {s.points.map((p) => (
            <li key={p.name}>
              <strong>{p.name}.</strong> {p.text}
            </li>
          ))}
        </ul>
        <p className="sn-boundary">{s.boundary}</p>
      </div>
    </section>
  );
}
