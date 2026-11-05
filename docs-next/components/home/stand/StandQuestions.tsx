'use client';

import Link from 'next/link';
import { QUESTIONS } from './copy';

/** Odd segments between backticks are code. */
function Answer({ text }: { text: string }) {
  return <>{text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}</>;
}

/** Where the home page ends. What first-time readers asked, answered only as far as we can show. */
export function StandQuestions() {
  const s = QUESTIONS;
  return (
    <section className="sq" aria-labelledby="sq-title">
      <h2 id="sq-title">{s.title}</h2>
      <div className="sq-list">
        {s.items.map((item) => (
          <details key={item.q}>
            <summary>
              <h3>{item.q}</h3>
            </summary>
            <p>
              <Answer text={item.a} />
            </p>
          </details>
        ))}
      </div>
      <div className="sc-links">
        <Link className="v2-button v2-button-primary" href="/how-it-stands" prefetch={false}>
          How it stands <span aria-hidden="true">→</span>
        </Link>
        <Link className="v2-button v2-button-quiet" href="/how-it-works" prefetch={false}>
          How it works <span aria-hidden="true">→</span>
        </Link>
        <Link className="v2-button v2-button-quiet" href="/docs/getting-started/quick-start" prefetch={false}>
          Build your first agent <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
