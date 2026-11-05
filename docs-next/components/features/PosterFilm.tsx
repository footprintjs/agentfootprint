'use client';

import Link from 'next/link';
import { FilmStage } from '../home/stand/FilmStage';
import { FEATURE_BEATS, FEATURES_TAGLINE } from '@/lib/features/beats';
import { POSTER_END, POSTER_STOPS } from './posterTimeline';

const load = () =>
  Promise.all([import('../home/stand/live'), import('./posterEngine'), import('./posterTimeline')]).then(
    ([{ bootFilm }, { PosterFilm: Engine }, timeline]) =>
      (root: HTMLElement) =>
        bootFilm<null>(root, null, {
          make: (canvas) => new Engine(canvas, null),
          end: timeline.POSTER_END,
          chapters: timeline.POSTER_CHAPTERS,
          stills: timeline.POSTER_STILLS,
        }),
  );

/** Eight verbs, eight posters. You fly through each word into the next one. */
export function PosterFilm() {
  return (
    <FilmStage
      id="features-film"
      className="sf-posters"
      label="What the framework does, in eight posters"
      labels={null}
      load={load}
      stops={POSTER_STOPS}
      end={POSTER_END}
      skip={{ href: '#features-next', label: 'Skip', more: 'to the end' }}
      hero={
        <>
          <p className="sf-kicker">
            <span aria-hidden="true" /> What you get
          </p>
          <h1>{FEATURES_TAGLINE}</h1>
          <p className="sf-tag">Eight things it does, in eight words.</p>
          <div className="sf-actions">
            <button type="button" className="v2-button v2-button-primary" data-film-play data-play-idle="Play the film">
              <span data-play-label>Play the film</span>
            </button>
            <Link className="v2-button v2-button-quiet" href="/framework" prefetch={false}>
              The whole framework <span aria-hidden="true">→</span>
            </Link>
          </div>
          <p className="sf-hint" aria-hidden="true">
            <span className="sf-mouse" /> Scroll to play it
          </p>
        </>
      }
      caps={FEATURE_BEATS.map((beat) => ({
        id: beat.id,
        h: beat.verb,
        s: beat.line,
        extra: (
          <div className="sf-inside">
            <ul>
              {beat.inside.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <Link href={beat.href} prefetch={false} aria-label={beat.hrefLabel}>
              Read more <span aria-hidden="true">→</span>
            </Link>
          </div>
        ),
      }))}
    />
  );
}
