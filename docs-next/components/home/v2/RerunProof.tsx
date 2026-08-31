import styles from './ProductScenes.module.css';

const TRACE = [
  ['intent', 'support.refund'],
  ['skill', 'billing.refund'],
  ['context', 'policy/refunds-v1'],
] as const;

export function RerunProof() {
  return (
    <figure className={`${styles.scene} ${styles.rerunScene}`}>
      <figcaption className={styles.rerunCaption}>
        <span>One recorded run</span>
        <strong>One controlled change</strong>
      </figcaption>

      <div className={styles.rerunGrid}>
        <section className={styles.runPanel} aria-label="Original recorded run">
          <header>
            <span>original · 8f2</span>
            <b>recorded</b>
          </header>
          <ol className={styles.traceList}>
            {TRACE.map(([kind, value]) => (
              <li className={kind === 'context' ? styles.suspectTrace : undefined} key={kind}>
                <span>{kind}</span>
                <code>{value}</code>
                {kind === 'context' ? <small>suspect</small> : null}
              </li>
            ))}
          </ol>
          <div className={`${styles.decision} ${styles.wrongDecision}`}>
            <span>decision</span>
            <strong>APPROVE</strong>
            <small>wrong output</small>
          </div>
        </section>

        <div className={styles.rerunControl} aria-label="Rerun removes the suspect source">
          <span>rerun</span>
          <del>policy/refunds-v1</del>
          <i aria-hidden="true">→</i>
        </div>

        <section
          className={`${styles.runPanel} ${styles.replayPanel}`}
          aria-label="Controlled rerun"
        >
          <header>
            <span>rerun · 8f2-r1</span>
            <b>same case</b>
          </header>
          <div className={styles.removedSource}>
            <span>context</span>
            <del>policy/refunds-v1</del>
            <small>removed</small>
          </div>
          <div className={`${styles.decision} ${styles.correctDecision}`}>
            <span>decision</span>
            <ins>DENY</ins>
            <small>changed result</small>
          </div>
          <p className={styles.confirmed}>
            <span aria-hidden="true">✓</span>
            <strong>Dependence confirmed</strong>
          </p>
        </section>
      </div>

      <p className={styles.rerunLimit}>
        Counterfactual replay tests the recorded run. It does not expose private model reasoning.
      </p>
    </figure>
  );
}
