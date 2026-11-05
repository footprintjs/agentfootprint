'use client';

import { useMemo } from 'react';
import { SceneFrame } from '../stand/SceneFrame';
import { useStandView, ViewSwitch } from '../stand/StandView';
import { HOW_COPY, type HowChapter, type HowLabels } from './howCopy';
import { HOW_SCENES } from './howTimeline';

/* The five layers of evidence, then what the same record gives you besides. */
const STEPS: readonly { readonly mark: string; readonly chapters: readonly HowChapter[] }[] = [
  { mark: '1', chapters: ['wrong', 'ask'] },
  { mark: '2', chapters: ['record'] },
  { mark: '3', chapters: ['walk'] },
  { mark: '4', chapters: ['address', 'suspect'] },
  { mark: '5', chapters: ['rerun'] },
  { mark: '+', chapters: ['forward', 'loop'] },
];

const JUMPS: readonly { readonly mark: string; readonly to: HowChapter; readonly label: string }[] = [
  { mark: '1', to: 'wrong', label: 'The wrong answer' },
  { mark: '2', to: 'record', label: 'The record' },
  { mark: '3', to: 'walk', label: 'The walk back' },
  { mark: '4', to: 'address', label: 'The suspect' },
  { mark: '5', to: 'rerun', label: 'The test' },
];

function ChapterScene({ chapter, labels }: { chapter: HowChapter; labels: HowLabels }) {
  const { scene, from, to } = HOW_SCENES[chapter];
  const load = useMemo(
    () => () =>
      import('./backFilm').then(
        ({ BackFilm }) =>
          (canvas: HTMLCanvasElement, l: HowLabels) =>
            new BackFilm(canvas, l, scene),
      ),
    [scene],
  );
  return <SceneFrame load={load} labels={labels} from={from} to={to} />;
}

/** One wrong answer, walked back to its cause, step by step. Two views change the words only. */
export function HowStory() {
  const { view } = useStandView();
  const copy = HOW_COPY[view === 'technical' ? 'technical' : 'product'];
  const chapter = (id: HowChapter, className = 'hw-chapter') => (
    <div className={className} id={id} key={id}>
      <div>
        <h2>{copy.caps[id].h}</h2>
        <p>{copy.caps[id].s}</p>
      </div>
      <ChapterScene chapter={id} labels={copy.labels} />
    </div>
  );
  return (
    <>
      <header className="hs-hero">
        <p className="v2-kicker">One failed run. Five layers of evidence.</p>
        <h1>
          Follow a wrong answer <em>all the way back</em> to its cause.
        </h1>
        <p>Asking the model why only gets you a confident guess.</p>
        <p className="hw-lede">{copy.lede}</p>
        <ViewSwitch className="hw-views" only={['product', 'technical']} />
      </header>
      <nav aria-label="The five steps">
        <ol className="hw-jump">
          {JUMPS.map((jump) => (
            <li key={jump.to}>
              <a href={`#${jump.to}`}>
                <span aria-hidden="true">{jump.mark}</span> {jump.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <section className="sg hw-steps" aria-label="The walk back, step by step">
        {STEPS.map((step) => (
          <article className="sg-letter" key={step.mark}>
            <div className="sg-big" aria-hidden="true">
              {step.mark}
            </div>
            <div className="sg-body">{step.chapters.map((id) => chapter(id))}</div>
          </article>
        ))}
        {chapter('end', 'hw-chapter hw-end')}
      </section>
    </>
  );
}
