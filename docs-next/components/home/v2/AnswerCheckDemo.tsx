'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ANSWER_CHECK_FIXTURES,
  ANSWER_CHECK_GAP,
  ANSWER_CHECK_REQUEST,
} from '../../demos/answerCheckFixtures';
import type { AnswerCheckDemoResult } from '../../demos/answerCheckDemo';
import styles from './AnswerCheckDemo.module.css';

/** Only fixture text and controls ship eagerly; the actual Agent loads on Run. */
export function AnswerCheckDemo() {
  const [selected, setSelected] = useState(0);
  const [result, setResult] = useState<AnswerCheckDemoResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(false);
  const fixture = ANSWER_CHECK_FIXTURES[selected];

  async function run() {
    setRunning(true);
    setResult(null);
    setError(false);
    try {
      const { runAnswerCheckDemo } = await import('../../demos/answerCheckDemo');
      setResult(await runAnswerCheckDemo(fixture));
    } catch {
      // A bundle/runtime failure is not a successful withholding verdict.
      setError(true);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className={styles.demo} id="answer-check" aria-labelledby="answer-check-title">
      <header className={styles.heading}>
        <div>
          <p className="v2-kicker">Try an answer check</p>
          <h2 id="answer-check-title">Same draft. Different evidence.</h2>
          <p>
            Run a real agent with a scripted reply. Your app declares the checks; the runtime
            decides whether that reply can be delivered.
          </p>
        </div>
        <span className={styles.fixtureBadge}>Scripted fixture · no live model</span>
      </header>

      <fieldset className={styles.scenarios} disabled={running}>
        <legend>Choose the lookup result</legend>
        {ANSWER_CHECK_FIXTURES.map((option, index) => (
          <label key={option.id} className={selected === index ? styles.selected : undefined}>
            <input
              type="radio"
              name="answer-check-scenario"
              value={option.id}
              checked={selected === index}
              onChange={() => {
                setSelected(index);
                setResult(null);
                setError(false);
              }}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <p className={styles.explanation}>{fixture.explanation}</p>

      <div className={styles.flow}>
        <article className={styles.card}>
          <span className={styles.step}>01 · Lookup evidence</span>
          <h3>{fixture.evidence ? `Refund: ${fixture.evidence.status}` : 'Lookup unavailable'}</h3>
          <dl>
            <div>
              <dt>Customer</dt>
              <dd>{ANSWER_CHECK_REQUEST.customerId}</dd>
            </div>
            <div>
              <dt>Order</dt>
              <dd>{ANSWER_CHECK_REQUEST.orderId}</dd>
            </div>
            <div>
              <dt>Read at</dt>
              <dd>{fixture.evidence ? '12:00 UTC' : 'No usable result'}</dd>
            </div>
          </dl>
          <p className={styles.gap}>{ANSWER_CHECK_GAP}</p>
        </article>
        <article className={styles.card}>
          <span className={styles.step}>02 · Scripted draft</span>
          <h3>Refund: {fixture.draft.status}</h3>
          <p>
            For order {fixture.draft.orderId}, customer {fixture.draft.customerId}.
          </p>
          <p className={styles.gap}>
            A candidate for checking. Showing it here does not mean it was delivered.
          </p>
        </article>
        <article className={styles.card}>
          <span className={styles.step}>03 · App rules</span>
          <h3>Check before delivery</h3>
          <ul>
            <li>Same customer and order</li>
            <li>Lookup no older than five minutes</li>
            <li>Status and time match the lookup</li>
          </ul>
          <p className={styles.gap}>Enforce mode · evidence read in the caller’s scope</p>
        </article>
      </div>

      <div className={styles.runRow}>
        <button className="v2-button v2-button-primary" disabled={running} onClick={run}>
          {running ? 'Running the check…' : 'Run answer check'}
          <span aria-hidden="true">→</span>
        </button>
        <p>Fixed fixture clock: 15 Jan 2026, 12:02 UTC. Nothing is refunded.</p>
      </div>

      <div className={styles.output} aria-live="polite" aria-atomic="true" aria-busy={running}>
        {error ? (
          <p role="alert">
            The demo could not run. No check result is available. Please try again.
          </p>
        ) : result ? (
          <>
            <div className={styles.outputTop}>
              <span className={styles.step}>04 · Customer-facing answer</span>
              <strong className={result.delivered ? styles.passed : styles.withheld}>
                {result.delivered
                  ? 'Passed app checks'
                  : `Draft withheld · ${result.report.status}`}
              </strong>
            </div>
            <p className={styles.answer}>{result.customerAnswer}</p>
            <p className={styles.renderNote}>
              {result.delivered
                ? 'App template rendered from the checked fields.'
                : 'App-owned fallback. This does not confirm a refund status.'}{' '}
              The lookup ran {result.toolCalls} time. {result.servedBeforeValidation.length} draft
              tokens were delivered before validation.
            </p>
            <details className={styles.report}>
              <summary>Inspect the actual check results</summary>
              <ul>
                {result.report.checks.map((check) => (
                  <li key={check.id}>
                    <code>{check.id}</code>
                    <span>{check.disposition}</span>
                  </li>
                ))}
              </ul>
              <p>
                {result.report.checked} comparisons ran · {result.report.failed} failed ·{' '}
                {result.report.unreachable} unreachable
              </p>
            </details>
          </>
        ) : (
          <p className={styles.placeholder}>
            {running
              ? 'Loading and running the real Agent runtime…'
              : 'Choose a scenario and run it to see what reaches the customer.'}
          </p>
        )}
      </div>

      <footer className={styles.footnote}>
        <p>
          This demonstrates configured checks, not model accuracy or independent verification of the
          refund ledger. Your app owns the rules, trusted sources and fallback wording. Unchecked
          prose is not covered.
        </p>
        <Link href="/docs/build/output-schema#check-the-answer-against-evidence">
          Use answer validation →
        </Link>
      </footer>
    </section>
  );
}
