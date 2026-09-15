'use client';

import { useState, type ReactNode } from 'react';
import { LiveSlideDeck } from 'storydeck/react';
import { answerSteps, conflictSteps, type StoryStep } from './story';
import './context-story.css';

type Story = 'answer' | 'conflict';
type ContextView = 'visual' | 'json';

function Card({
  label,
  children,
  tone = '',
  small = false,
}: {
  label: string;
  children: ReactNode;
  tone?: string;
  small?: boolean;
}) {
  return (
    <div className={`cx-card ${tone} ${small ? 'cx-small' : ''}`}>
      <span className="cx-caption">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="cx-arrow">
      <span aria-hidden="true">↓</span>
      <span>{label}</span>
    </div>
  );
}

function Packet({ step }: { step: number }) {
  return (
    <div className="cx-packet">
      <div className="cx-packet-head">
        <span className="cx-packet-icon" aria-hidden="true">
          ⊞
        </span>
        <strong>Prepared context</strong>
        <span>{step === 0 ? 'Empty' : `${Math.min(step, 3)} layers`}</span>
      </div>
      {step === 0 ? (
        <div className="cx-empty">
          <span aria-hidden="true">{`{ }`}</span>
          <p>Nothing prepared yet</p>
        </div>
      ) : (
        <div className="cx-packet-body">
          <div className="cx-layer">
            <span className="cx-layer-mark">01</span>
            <div>
              <strong>Question + selection</strong>
              <p>demo-a · 1 hour · P95 between 1–2 ms</p>
            </div>
          </div>
          {step >= 2 && (
            <div className="cx-layer">
              <span className="cx-layer-mark">02</span>
              <div>
                <strong>Data reference + meaning</strong>
                <p>nodes@v1 · microseconds · node summary</p>
              </div>
            </div>
          )}
          {step >= 3 && (
            <div className="cx-layer">
              <span className="cx-layer-mark">03</span>
              <div>
                <strong>Operation + limits</strong>
                <p>Rank selected nodes · cause unknown</p>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="cx-packet-foot">
        {step < 2
          ? 'The application prepares this before the model call.'
          : 'Source rows remain in the backend.'}
      </div>
    </div>
  );
}

function AnswerVisual({ index }: { index: number }) {
  if (index <= 3)
    return (
      <div className="cx-scene">
        <Card
          label={
            index === 0
              ? 'A person asks'
              : index === 1
              ? 'Saved dashboard selection'
              : index === 2
              ? 'Backend source'
              : 'An already-selected analytical skill'
          }
          small
        >
          {index === 0 ? (
            '“Which selected nodes have the highest reported P95 latency?”'
          ) : index === 1 ? (
            'Cluster demo-a · 14:00–15:00 UTC'
          ) : index === 2 ? (
            <>
              <strong>4 retained node summaries</strong>
              <p>11 · 12 · 13 · 14</p>
            </>
          ) : (
            <>
              <strong>Rank by reported P95</strong>
              <p>Check comparable assertions and declare coverage.</p>
            </>
          )}
        </Card>
        <Arrow
          label={
            [
              'Begin with an empty context',
              'Attach the saved scope',
              'Attach a reference, not the rows',
              'Prepare the first model call',
            ][index]
          }
        />
        <Packet step={index} />
      </div>
    );
  if (index === 4)
    return (
      <div className="cx-scene">
        <Packet step={3} />
        <Arrow label="First model call" />
        <Card label="Model’s next action" tone="cx-accent">
          <strong>Rank the selected nodes</strong>
          <p>Use nodes@v1 · highest P95 first · keep ties</p>
        </Card>
        <p className="cx-scene-note">
          The tool resolves the reference within the authorized scope.
        </p>
      </div>
    );
  if (index === 5)
    return (
      <div className="cx-scene">
        <div className="cx-caption">Backend result · two matching records</div>
        <div className="cx-metrics">
          <Card label="Node 11" tone="cx-accent">
            <strong className="cx-number">
              1,500 <small>µs</small>
            </strong>
          </Card>
          <span className="cx-equals" aria-label="equal">
            =
          </span>
          <Card label="Node 13" tone="cx-accent">
            <strong className="cx-number">
              1,500 <small>µs</small>
            </strong>
          </Card>
        </div>
        <div className="cx-excluded">
          <span>Node 12 · below filter</span>
          <span>Node 14 · unknown P95</span>
        </div>
        <Arrow label="Next model call gets the finding" />
        <Card label="Finding + source + coverage">
          <strong>Highest P95: a tie</strong>
          <p>finding:highest-p95@3 → nodes@v1</p>
          <p>Comparison supported · causal explanation unavailable</p>
        </Card>
      </div>
    );
  return (
    <div className="cx-scene">
      <div className="cx-check-icon" aria-hidden="true">
        ✓
      </div>
      <div className="cx-caption">Current finding reference accepted</div>
      <div className="cx-answer">
        <p>
          Nodes <mark>11 and 13</mark> tie at <mark>1.5 ms</mark> in this selection.
        </p>
        <span>These summaries do not establish the cause.</span>
      </div>
      <div className="cx-evidence-pills">
        <span>↗ Source: nodes@v1</span>
        <span>Selection: revision 3</span>
      </div>
      <p className="cx-scene-note">
        The model selects the finding. The renderer supplies its factual value.
      </p>
    </div>
  );
}

function ConflictVisual({ index }: { index: number }) {
  if (index <= 1)
    return (
      <div className="cx-scene">
        <div className="cx-identity">Same node 11 · same window · same snapshot · µs</div>
        <div className="cx-claims">
          <Card label="Retained record">
            <strong className="cx-number">1,150</strong>
            <p>Qualified source</p>
          </Card>
          <span className="cx-equals cx-red" aria-label="not equal">
            ≠
          </span>
          <Card label="Prepared summary" tone="cx-danger">
            <strong className="cx-number">1,500</strong>
            <p>Faulty projection</p>
          </Card>
        </div>
        <Arrow
          label={
            index === 0
              ? 'Comparable identity declared by the adapter'
              : 'ContextFootprint returns both witnesses'
          }
        />
        <Card
          label={index === 0 ? 'Comparison boundary' : '1 conflict found'}
          tone={index === 1 ? 'cx-danger' : ''}
        >
          <strong>
            {index === 0 ? 'One measurement. Two different values.' : 'The facts disagree.'}
          </strong>
          <p>
            {index === 0
              ? 'Do not compare unrelated windows as if they were the same claim.'
              : 'The comparator names the disagreement; the host decides what to do.'}
          </p>
        </Card>
      </div>
    );
  if (index === 2)
    return (
      <div className="cx-scene">
        <Card label="Host policy" tone="cx-danger">
          <strong>Ⅱ Factual model call paused</strong>
          <p>Keep the conflicting pair in diagnostics.</p>
        </Card>
        <Arrow label="Re-resolve the authorized reference" />
        <Card label="Retained record">
          <strong className="cx-number">
            1,150 <small>µs</small>
          </strong>
          <p>The record is unchanged. Rebuild its summary.</p>
        </Card>
        <p className="cx-scene-note">
          For competing authoritative sources, a different resolution policy is needed.
        </p>
      </div>
    );
  if (index === 3)
    return (
      <div className="cx-scene">
        <div className="cx-claims">
          <Card label="Retained record">
            <strong className="cx-number">1,150</strong>
          </Card>
          <span className="cx-equals">=</span>
          <Card label="Rebuilt summary" tone="cx-success">
            <strong className="cx-number">1,150</strong>
          </Card>
        </div>
        <Arrow label="Compare again · no conflict for this claim" />
        <Card label="Prepared for the model" tone="cx-success">
          <strong>Node 11 · 1,150 µs</strong>
          <p>Current finding reference + source window + limitations</p>
        </Card>
        <p className="cx-scene-note">
          The old conflicting summary stays in diagnostics, outside this model context.
        </p>
      </div>
    );
  if (index === 4)
    return (
      <div className="cx-scene">
        <Card label="Simulated structured draft" tone="cx-danger">
          <strong>
            Node 11 reports <s>1,500 µs</s>
          </strong>
          <p>Current reference, incorrect copied value</p>
        </Card>
        <Arrow label="Configured final-answer check" />
        <Card label="Not delivered" tone="cx-danger">
          <strong>Value does not match the stored finding.</strong>
          <p>Expected 1,150 µs. The host allows one repair attempt.</p>
        </Card>
        <p className="cx-scene-note">
          A valid reference alone does not make a copied number correct.
        </p>
      </div>
    );
  return (
    <div className="cx-scene">
      <div className="cx-check-icon" aria-hidden="true">
        ✓
      </div>
      <div className="cx-caption">Reference-only answer accepted</div>
      <div className="cx-answer">
        <p>
          Node <mark>11</mark> reports <mark>1.15 ms</mark> in this source window.
        </p>
        <span>The cause of its latency remains unknown.</span>
      </div>
      <div className="cx-evidence-pills">
        <span>↗ Authorized retained record</span>
        <span>Checks passed</span>
      </div>
      <p className="cx-scene-note">
        The number comes from the stored finding—not a second model calculation.
      </p>
    </div>
  );
}

function Slide({
  step,
  index,
  story,
  view,
}: {
  step: StoryStep;
  index: number;
  story: Story;
  view: ContextView;
}) {
  return (
    <div className="cx-slide">
      <div className="cx-narrative">
        <p className="cx-eyebrow">
          {String(index + 1).padStart(2, '0')} / {step.label}
        </p>
        <h2>{step.title}</h2>
        <p className="cx-description">{step.description}</p>
        <div className="cx-owner">
          <span>Who handles this</span>
          <strong>{step.owner}</strong>
        </div>
        <div className="cx-takeaway">
          <span aria-hidden="true">↳</span>
          <p>{step.takeaway}</p>
        </div>
      </div>
      <div className="cx-visual">
        {view === 'json' ? (
          <div className="cx-json-panel">
            <div className="cx-caption">Context at this step · {step.label}</div>
            <pre tabIndex={0} aria-label={`JSON context: ${step.label}`}>
              <code>{JSON.stringify(step.context, null, 2)}</code>
            </pre>
            <p>
              Illustrative context projection. Not a provider message or runnable API configuration.
            </p>
          </div>
        ) : story === 'answer' ? (
          <AnswerVisual index={index} />
        ) : (
          <ConflictVisual index={index} />
        )}
      </div>
    </div>
  );
}

export function ContextStory() {
  const [story, setStory] = useState<Story>('answer');
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<ContextView>('visual');
  const steps = story === 'answer' ? answerSteps : conflictSteps;
  const step = steps[index];
  const go = (next: number) => setIndex(Math.max(0, Math.min(steps.length - 1, next)));
  return (
    <section className="cx-walkthrough" aria-label="Interactive context walkthrough">
      <div className="cx-story-bar">
        <div className="cx-stories" role="group" aria-label="Choose an example">
          <button
            type="button"
            aria-pressed={story === 'answer'}
            onClick={() => {
              setStory('answer');
              setIndex(0);
            }}
          >
            01 <span>Build an answer</span>
          </button>
          <button
            type="button"
            aria-pressed={story === 'conflict'}
            onClick={() => {
              setStory('conflict');
              setIndex(0);
            }}
          >
            02 <span>Catch a conflict</span>
          </button>
        </div>
        <span className="cx-simulation">Illustrated example · no live model</span>
      </div>
      <nav className="cx-step-nav" aria-label="Walkthrough steps">
        {steps.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => go(i)}
            aria-current={i === index ? 'step' : undefined}
          >
            <span>{i < index ? '✓' : i + 1}</span>
            {s.label}
          </button>
        ))}
      </nav>
      <div className="cx-view-bar">
        <span>One step. Two views.</span>
        <div role="group" aria-label="Context representation">
          <button type="button" aria-pressed={view === 'visual'} onClick={() => setView('visual')}>
            Visual
          </button>
          <button type="button" aria-pressed={view === 'json'} onClick={() => setView('json')}>
            JSON
          </button>
        </div>
      </div>
      <LiveSlideDeck
        slides={steps}
        index={index}
        onIndexChange={setIndex}
        onNavigate={(intent) =>
          go(
            intent.action === 'next'
              ? index + 1
              : intent.action === 'previous'
              ? index - 1
              : intent.index,
          )
        }
        className="cx-stage"
        renderSlide={({ slide, index: slideIndex }) => (
          <Slide step={slide} index={slideIndex} story={story} view={view} />
        )}
      />
      <noscript>
        <p className="cx-noscript">
          Enable JavaScript for the slide walkthrough. The layer guide below explains the same
          design without interactive controls.
        </p>
      </noscript>
      <div className="cx-navigation">
        <button type="button" disabled={index === 0} onClick={() => go(index - 1)}>
          ← Previous
        </button>
        <p aria-live="polite" aria-atomic="true">
          {index + 1} of {steps.length} <span>· {step.label}</span>
        </p>
        <button
          type="button"
          className="cx-next"
          onClick={() => {
            if (index === steps.length - 1) {
              setStory(story === 'answer' ? 'conflict' : 'answer');
              setIndex(0);
            } else go(index + 1);
          }}
        >
          {index === steps.length - 1
            ? story === 'answer'
              ? 'See a conflict'
              : 'Build an answer'
            : 'Next step'}{' '}
          →
        </button>
      </div>
      <div className="cx-deck-credit">
        Slide navigation powered by StoryDeck. Focus the slide, then use ← / →.
      </div>
    </section>
  );
}
