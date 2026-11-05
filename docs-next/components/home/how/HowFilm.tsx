'use client';

import Link from 'next/link';
import { FilmStage } from '../stand/FilmStage';
import { useStandView, ViewSwitch } from '../stand/StandView';
import { HOW_BADGE, HOW_COPY, HOW_IDS, type HowLabels } from './howCopy';
import { H, HOW_STOPS } from './howTimeline';

const load = () =>
  Promise.all([import('../stand/live'), import('./backFilm'), import('./howTimeline')]).then(
    ([{ bootFilm }, { BackFilm }, timeline]) =>
      (root: HTMLElement, labels: HowLabels) =>
        bootFilm(root, labels, {
          make: (canvas, l) => new BackFilm(canvas, l),
          end: timeline.H.end,
          chapters: timeline.HOW_CHAPTERS,
          stills: timeline.HOW_STILLS,
        }),
  );

/** One wrong answer, walked back to its cause. The home film runs forward; this one runs back. */
export function HowFilm() {
  const { view } = useStandView();
  const copy = HOW_COPY[view === 'technical' ? 'technical' : 'product'];
  return (
    <FilmStage
      id="how-film"
      label="Following a wrong answer back to its cause, as a film"
      labels={copy.labels}
      load={load}
      rev={view}
      switcher={<ViewSwitch className="sf-views-stage" only={['product', 'technical']} />}
      stops={HOW_STOPS}
      end={H.end}
      skip={{ href: '#how-next', label: 'Skip', more: 'to the code' }}
      hero={
        <>
          <p className="sf-kicker">
            <span aria-hidden="true" /> One failed run. Five layers of evidence.
          </p>
          <h1>
            Follow a wrong answer <em>all the way back</em> to its cause.
          </h1>
          <p className="sf-tag">Asking the model why only gets you a confident guess.</p>
          <p className="sf-lede" key={view}>
            {copy.lede}
          </p>
          <div className="sf-actions">
            <button type="button" className="v2-button v2-button-primary" data-film-play data-play-idle="Play the film">
              <span data-play-label>Play the film</span>
            </button>
            <Link className="v2-button v2-button-quiet" href="/how-it-works/walkthrough" prefetch={false}>
              The full walkthrough <span aria-hidden="true">→</span>
            </Link>
          </div>
          <p className="sf-hint" aria-hidden="true">
            <span className="sf-mouse" /> Scroll to play it
          </p>
        </>
      }
      caps={HOW_IDS.map((id) => ({
        id,
        letter: HOW_BADGE[id],
        h: copy.caps[id].h,
        s: copy.caps[id].s,
        extra:
          id === 'end' ? (
            <div className="sf-actions">
              <Link className="v2-button v2-button-primary" href="/docs/debug/localize-context-bug" prefetch={false}>
                Trace your first run <span aria-hidden="true">→</span>
              </Link>
              <Link className="v2-button v2-button-quiet" href="/how-it-works/walkthrough" prefetch={false}>
                The full walkthrough <span aria-hidden="true">→</span>
              </Link>
            </div>
          ) : null,
      }))}
    />
  );
}
