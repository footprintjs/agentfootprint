'use client';

const QUESTIONS = [
  {
    q: 'Who judged this answer, code or another model?',
    a: <>Code, comparing the answer with the record. No model sets the standing, unless you put one inside your own check.</>,
  },
  {
    q: 'When a check passes, does it call the answer verified?',
    a: (
      <>
        No. The line reads &ldquo;This is not a verification.&rdquo; Only a check you wrote can reach known, and the
        library cannot see how it decided.
      </>
    ),
  },
  {
    q: 'When a search finds nothing, does the answer say what was not searched?',
    a: (
      <>
        It does when the tool declares it. <code>absent()</code> states what was checked and what was not, and the
        answer reads not sure.
      </>
    ),
  },
  {
    q: 'Can the person reading see who vouches for each line?',
    a: (
      <>
        Yes. Explain this answer names the person, library, tool, model or app behind each line, written from the
        record by fixed templates and never by a model.
      </>
    ),
  },
];

/** How this differs from other frameworks: questions a reader can check for themselves, and what the others' docs show. */
export function StandPosition() {
  return (
    <section className="v21-position" aria-labelledby="v21-position-title">
      <p className="v2-kicker">Choosing a framework</p>
      <h2 id="v21-position-title">Four questions to ask of any agent framework.</h2>
      <p>
        LangChain, Mastra and others help teams build agent applications, and their guardrails can block an answer. So
        the useful question is not who has checks. It is what a check can honestly say.
      </p>
      <div className="v21-comparison-wrap">
        <table>
          <caption>The same four questions work on any framework, this one included.</caption>
          <thead>
            <tr>
              <th scope="col">Ask of any framework</th>
              <th scope="col">AgentFootprint</th>
            </tr>
          </thead>
          <tbody>
            {QUESTIONS.map((row) => (
              <tr key={row.q}>
                <th scope="row">{row.q}</th>
                <td>{row.a}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="v21-guardrail">
        A filter that reads only an answer&rsquo;s words gives the same verdict on the same words. The demo above gives
        one draft three outcomes, because its check reads the record. Here a tool marks a fact, you declare which field
        reports it, and the library does the comparison. Anything else is a rule you write.
      </p>
      <details className="v21-docs">
        <summary>What other frameworks&rsquo; docs show, as of November 2026</summary>
        <p>
          <a href="https://docs.smith.langchain.com/observability/how_to_guides/online_evaluations">
            LangSmith&rsquo;s online evaluators
          </a>{' '}
          score production traces with an LLM judge or your own code.{' '}
          <a href="https://mastra.ai/en/reference/evals/hallucination">Mastra&rsquo;s hallucination scorer</a> asks a
          model and returns a score.{' '}
          <a href="https://docs.nvidia.com/nemo/guardrails/latest/configure-rails/guardrail-catalog/fact-checking.html">
            NeMo Guardrails&rsquo; fact-checking rail
          </a>{' '}
          returns a score, and its docs say the result depends on the model doing the checking.{' '}
          <a href="https://docs.langchain.com/oss/javascript/langchain/guardrails">LangChain</a> and{' '}
          <a href="https://mastra.ai/docs/agents/processors">Mastra</a> guardrails can block an answer and can see the
          run&rsquo;s messages or tool results, and their guides leave that comparison to you.
        </p>
      </details>
      <p className="v21-boundary">
        This is a difference in emphasis, not a claim of exclusive capabilities or measured superiority. Someone could
        build any of this elsewhere. Here it is the design.
      </p>
    </section>
  );
}
