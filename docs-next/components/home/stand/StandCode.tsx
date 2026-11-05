'use client';

import Link from 'next/link';
import { CODE_SECTION, type CodeSample } from './copy';

/** Every line as the test runs it, with the lines that are the point marked. */
function Code({ sample }: { sample: CodeSample }) {
  return (
    <pre className="sc-code" tabIndex={0}>
      <code>
        {sample.code.split('\n').map((line, i) => (
          <span
            className={`sc-line${sample.marks.some((mark) => line.includes(mark)) ? ' is-mark' : ''}`}
            key={i}
          >
            {line || ' '}
          </span>
        ))}
      </code>
    </pre>
  );
}

/** How little you add, and the plain answer on whether you have to move. */
export function StandCode() {
  const s = CODE_SECTION;
  return (
    <section className="sc" id="stand-code" aria-labelledby="sc-title">
      <header className="sc-head">
        <p className="v2-kicker">{s.kicker}</p>
        <h2 id="sc-title">{s.title}</h2>
        <p>{s.lede}</p>
      </header>
      <div className="sc-samples">
        {s.samples.map((sample) => (
          <article className="sc-sample" key={sample.title}>
            <h3>{sample.title}</h3>
            <p>{sample.text}</p>
            <Code sample={sample} />
            <div className="sc-out">
              <span>{sample.outputLabel}</span>
              <pre>{sample.output}</pre>
            </div>
          </article>
        ))}
      </div>
      <div className="sc-links">
        <Link className="v2-button v2-button-primary" href="/docs/getting-started/quick-start" prefetch={false}>
          Build your first agent <span aria-hidden="true">→</span>
        </Link>
        <Link className="v2-button v2-button-quiet" href="/docs/getting-started/vs#migration" prefetch={false}>
          Coming from another framework <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
