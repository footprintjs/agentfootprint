import { CodeText } from './StandGrid';
import { LEAVES, STOPS, TOLD, UNMEASURED } from './standsCopy';

/** What the model is sent, when the answer leaves, where this stops, and what nobody has measured. */
export function StandHonesty() {
  return (
    <>
      <section className="hs-sec" id="told" aria-labelledby="hs-told">
        <h2 id="hs-told">What the model is told</h2>
        <p>Most checks add nothing to what the model is sent. Here is what each setting adds.</p>
        <table className="hs-table">
          <thead>
            <tr>
              <th scope="col">Setting</th>
              <th scope="col">Added to the prompt</th>
              <th scope="col">Sent back to the model</th>
            </tr>
          </thead>
          <tbody>
            {TOLD.map((row) => (
              <tr key={row.setting}>
                <th scope="row">
                  <CodeText text={row.setting} />
                </th>
                <td data-label="Added to the prompt">
                  <CodeText text={row.adds} />
                </td>
                <td data-label="Sent back to the model">
                  <CodeText text={row.back} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hs-note">
          After an answer exists, the model is asked again in four cases: an invented value under guard or rails, a bad
          shape with retries on, unfinished steps, and a bad citation on a &ldquo;not found&rdquo; claim. A run that hits
          its limit gets one separate wrap-up call.
        </p>
      </section>

      <section className="hs-sec" id="leaves" aria-labelledby="hs-leaves">
        <h2 id="hs-leaves">When the answer leaves</h2>
        <table className="hs-table">
          <thead>
            <tr>
              <th scope="col">Path</th>
              <th scope="col">When streamed text leaves</th>
              <th scope="col">If a check finds a problem</th>
            </tr>
          </thead>
          <tbody>
            {LEAVES.map((row) => (
              <tr key={row.path}>
                <th scope="row">
                  <CodeText text={row.path} />
                </th>
                <td data-label="When streamed text leaves">{row.when}</td>
                <td data-label="If a check finds a problem">
                  <CodeText text={row.fails} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hs-note">
          So &ldquo;checked before anyone sees it&rdquo; holds only for structured answers with a check, or when nothing
          streams. Prose can never reach known.
        </p>
      </section>

      <section className="hs-sec" id="stops" aria-labelledby="hs-stops">
        <h2 id="hs-stops">Where it stops</h2>
        <ul className="hs-list">
          {STOPS.map((stop) => (
            <li key={stop.name}>
              <strong>{stop.name}.</strong> {stop.text}
            </li>
          ))}
        </ul>
      </section>

      <section className="hs-sec" id="unmeasured" aria-labelledby="hs-unmeasured">
        <h2 id="hs-unmeasured">What we have not measured</h2>
        <ul className="hs-list">
          {UNMEASURED.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
