import styles from './ProductScenes.module.css';

export function ReferenceFlow() {
  return (
    <figure className={`${styles.scene} ${styles.referenceScene}`}>
      <figcaption className={styles.srOnly}>
        In this configured artifact path, a large tool result splits into two parts. The payload is
        stored outside model context. A small artifact ticket enters the conversation, where the
        model can route it to the present tool. The product interface redeems the ticket and loads
        the payload from the artifact store.
      </figcaption>

      <div className={styles.sceneTopline} aria-hidden="true">
        <span>Configured artifact path</span>
        <span>Payload stored · ticket in context</span>
      </div>

      <div className={styles.flowMap} aria-hidden="true">
        <article className={styles.flowSource}>
          <span>Tool result</span>
          <strong>customer data</strong>
          <small>large payload</small>
        </article>

        <i className={styles.flowFork} />

        <div className={styles.flowBranches}>
          <section className={`${styles.flowBranch} ${styles.payloadBranch}`}>
            <header>
              <strong>Payload</strong>
              <span>outside context</span>
            </header>
            <div className={styles.branchTrack}>
              <span className={styles.payloadPacket}>data</span>
              <article className={styles.flowStore}>
                <strong>Artifact store</strong>
                <small>payload stays here</small>
              </article>
            </div>
          </section>

          <section className={`${styles.flowBranch} ${styles.refBranch}`}>
            <header>
              <strong>Ticket</strong>
              <span>in Messages</span>
            </header>
            <div className={styles.branchTrack}>
              <code className={styles.refPacket}>art_h7Kq…</code>
              <article className={styles.flowModel}>
                <strong>LLM</strong>
                <small>ticket only</small>
              </article>
              <span className={styles.renderPacket}>present(ref)</span>
            </div>
          </section>
        </div>

        <i className={styles.flowMerge} />

        <article className={styles.flowUi}>
          <span>Product UI</span>
          <strong>Redeem + render</strong>
          <small>loads by artifact kind</small>
        </article>
      </div>

      <div className={styles.flowVerdict}>
        <strong>The model routes the ticket.</strong>
        <span>The UI redeems the payload.</span>
      </div>
    </figure>
  );
}
