import styles from './ProductScenes.module.css';

const TRACE_ROWS = [
  ['route', 'refund'],
  ['context', 'skill + art_…'],
  ['tool', 'policy'],
  ['decision', 'approve'],
] as const;

const PORTS = ['Models', 'Memory', 'Storage', 'Hosting', 'Observe'] as const;

export function RuntimeSystemHero() {
  return (
    <figure className={`${styles.scene} ${styles.runtimeSystemHero}`}>
      <figcaption className={styles.srOnly}>
        Your product owns its interface, SkillGraph business logic, and artifact data contracts.
        The separate AgentFootprint runtime selects the active work, maps its context to the model
        interface, and executes the graph and ReAct loop. In this example, an artifact ticket enters
        model context while its payload stays in the store for the product UI to redeem. Typed run
        events can feed live debugging and optional post-run evidence through replaceable
        infrastructure ports.
      </figcaption>

      <header className={styles.runtimeSystemTopline} aria-hidden="true">
        <span className={styles.runtimeLive}>
          <i /> run 8f2 · live
        </span>
        <span>logic + data → execution → evidence</span>
      </header>

      <div className={styles.runtimeSystemBody}>
        <section className={styles.saasLayer} aria-label="Your product application layer">
          <header className={styles.systemLayerHeader}>
            <strong>Your product</strong>
            <span>SaaS</span>
          </header>

          <section className={styles.saasInterface} aria-label="Application interface">
            <p className={styles.systemRequest}>
              <span>user</span>
              Refund A-1001?
            </p>
            <p className={styles.systemAnswer}>
              <span>agent</span>
              Approved <b aria-label="complete">✓</b>
            </p>
            <p className={styles.systemWhy}>
              <span>follow-up</span>
              Why?
            </p>
          </section>

          <section className={styles.systemSkillGraph} aria-label="Selected SkillGraph context">
            <header>
              <strong>SkillGraph</strong>
              <small>business logic</small>
            </header>
            <p>
              <span>selected</span>
              <code>billing.refund</code>
            </p>
            <dl>
              <div>
                <dt>steps</dt>
                <dd>plan</dd>
              </div>
              <div>
                <dt>tools</dt>
                <dd>3</dd>
              </div>
              <div>
                <dt>model</dt>
                <dd>small</dd>
              </div>
            </dl>
          </section>

          <section className={styles.artifactContract} aria-label="Artifact contract and store">
            <header>
              <strong>Artifact contract</strong>
              <small>product data</small>
            </header>
            <p>
              <span>tool payload</span>
              <i aria-hidden="true">→</i>
              <b>store</b>
              <i aria-hidden="true">→</i>
              <b>UI</b>
            </p>
          </section>
        </section>

        <section className={styles.systemBridge} aria-label="Application runtime contracts">
          <h3 className={styles.srOnly}>Contracts between the application and runtime</h3>
          <p className={styles.contextLane}>
            <span>context</span>
            <i aria-hidden="true" />
          </p>
          <p className={styles.referenceLane}>
            <code>art_…</code>
            <i aria-hidden="true" />
          </p>
          <p className={styles.renderLane}>
            <span>result</span>
            <i aria-hidden="true" />
          </p>
        </section>

        <section className={styles.agentRuntimeLayer} aria-label="Agent runtime execution layer">
          <header className={styles.systemLayerHeader}>
            <strong>Agent runtime</strong>
            <span>maps context</span>
          </header>

          <section className={styles.systemGraphEngine} aria-label="Graph engine">
            <header>
              <strong>Graph engine</strong>
              <small>select</small>
            </header>
            <ol>
              <li>
                <span>01</span>
                intake
              </li>
              <li className={styles.systemGraphActive} aria-current="step">
                <span>02</span>
                refund
              </li>
              <li>
                <span>03</span>
                review
              </li>
            </ol>
          </section>

          <i className={styles.engineConnector} aria-hidden="true" />

          <section className={styles.systemLoopEngine} aria-label="Loop engine">
            <header>
              <strong>Loop engine</strong>
              <small>model call</small>
            </header>
            <ol>
              <li>observe</li>
              <li>decide</li>
              <li>act</li>
            </ol>
            <span aria-hidden="true">↺</span>
          </section>

          <p className={styles.runtimeReceipt}>
            <span aria-hidden="true">✓</span>
            result + events
          </p>
        </section>

        <i className={styles.inlineTraceBridge} aria-hidden="true" />

        <section className={styles.systemTrace} aria-label="Inline causal trace">
          <header>
            <strong>Causal trace</strong>
            <span>inline</span>
          </header>
          <ol>
            {TRACE_ROWS.map(([kind, value]) => (
              <li key={kind}>
                <span>{kind}</span>
                <strong>{value}</strong>
              </li>
            ))}
          </ol>
          <ul aria-label="Causal trace consumers">
            <li>Live debug</li>
            <li>Post-run</li>
          </ul>
        </section>
      </div>

      <footer className={styles.systemPorts} aria-label="Replaceable infrastructure ports">
        <span>Production config · adapters</span>
        <ul>
          {PORTS.map((port) => (
            <li key={port}>
              <i aria-hidden="true" />
              {port}
            </li>
          ))}
        </ul>
      </footer>
    </figure>
  );
}
