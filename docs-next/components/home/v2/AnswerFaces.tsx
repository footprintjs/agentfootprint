import { asset } from '@/lib/site';

/**
 * Six faces of an answer you can trust.
 *
 * The hero's own device, carried over from HexaVisage — the same author's
 * earlier statement of this idea, where six labelled hexagons sat under the
 * caption "Six faces of every self-explainable system". It works for a reason
 * worth keeping: every node is a WORD, so the picture is readable on its own.
 * An abstract swirl asks the reader to take the product on trust; a labelled
 * diagram tells them what it is before they read a line of copy.
 *
 * The six here are not the original six. Those describe a self-explaining
 * SYSTEM (structure, connection, topology, traversal, replay, explanation);
 * these describe a trustworthy ANSWER, which is what this page sells, and they
 * map one-to-one onto the hero sentence: it keeps the evidence, says what it
 * could not check, and refuses instead of guessing.
 *
 * Pure SVG, no dependency, no animation — the one moving thing in this hero is
 * the live dot in the eyebrow, and a second would compete with it.
 */
const FACES = [
  { label: 'Evidence', hint: 'what it saw' },
  { label: 'Decision', hint: 'what it chose' },
  { label: 'Reason', hint: 'why it chose it' },
  { label: 'Coverage', hint: 'what it could not check' },
  { label: 'Refusal', hint: 'when it will not guess' },
  { label: 'Replay', hint: 'prove the cause' },
] as const;

/** Flat-top hexagon path of a given radius, centred on the origin. */
function hexPath(radius: number): string {
  const points = Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 180) * (60 * index - 90);
    return `${(radius * Math.cos(angle)).toFixed(2)},${(radius * Math.sin(angle)).toFixed(2)}`;
  });
  return `M${points.join('L')}Z`;
}

const RING = 132;
const HEX = 34;

export function AnswerFaces() {
  return (
    <figure className="v21-faces">
      <svg viewBox="-210 -196 420 424" role="img" aria-labelledby="faces-title">
        <title id="faces-title">
          Six faces of an answer you can trust: evidence, decision, reason, coverage, refusal and
          replay, arranged around one recorded run.
        </title>

        {/* Edges between neighbours — the ring that makes six points read as one
            shape rather than six separate badges. */}
        {FACES.map((_, index) => {
          const a = (Math.PI / 180) * (60 * index - 90);
          const b = (Math.PI / 180) * (60 * ((index + 1) % 6) - 90);
          return (
            <line
              key={`edge-${index}`}
              className="v21-faces-edge"
              x1={(RING * Math.cos(a)).toFixed(2)}
              y1={(RING * Math.sin(a)).toFixed(2)}
              x2={(RING * Math.cos(b)).toFixed(2)}
              y2={(RING * Math.sin(b)).toFixed(2)}
            />
          );
        })}

        {FACES.map((face, index) => {
          const angle = (Math.PI / 180) * (60 * index - 90);
          const x = RING * Math.cos(angle);
          const y = RING * Math.sin(angle);
          const below = y > 40;
          return (
            <g key={face.label} className="v21-faces-face" style={{ ['--i' as string]: index }}>
              <line x1={0} y1={0} x2={x} y2={y} className="v21-faces-spoke" />
              <g transform={`translate(${x.toFixed(2)},${y.toFixed(2)})`}>
                <circle r={HEX + 8} className="v21-faces-wave" />
                <path d={hexPath(HEX)} className="v21-faces-hex" />
                <path d={hexPath(HEX - 10)} className="v21-faces-inner" />
                <circle r={3.2} className="v21-faces-dot" />
                <text
                  className="v21-faces-label"
                  textAnchor="middle"
                  y={below ? HEX + 22 : -HEX - 12}
                >
                  {face.label}
                </text>
                <text
                  className="v21-faces-hint"
                  textAnchor="middle"
                  y={below ? HEX + 37 : -HEX + 3}
                >
                  {face.hint}
                </text>
              </g>
            </g>
          );
        })}

        {/* The mascot sits at the centre the six faces orbit — the brand mark
            doing the job HexaVisage's hexagon core did, and a better centre than
            an empty ring because it is the one thing on the page that is ours. */}
        <path d={hexPath(46)} className="v21-faces-core" />
        <image
          href={asset('/mascot-400.webp')}
          x={-34}
          y={-34}
          width={68}
          height={68}
          preserveAspectRatio="xMidYMid meet"
        />
      </svg>
      <figcaption>Six faces of an answer you can trust.</figcaption>
    </figure>
  );
}
