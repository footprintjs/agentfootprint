'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { CHAPTER_IDS, CHAPTER_LETTER, CHAPTER_NEXT, COPY } from './copy';
import { FilmStage } from './FilmStage';
import { LINE, RAIL, T } from './timeline';
import { useStandView, ViewSwitch } from './StandView';

const load = () => import('./homeFilm').then(({ bootHomeFilm }) => bootHomeFilm);

/** The film at the top of the homepage. */
export function StandFilm() {
  const { view } = useStandView();
  const copy = COPY[view];
  return (
    <FilmStage
      id="stand-film"
      label="The STAND pattern, as a film"
      labels={copy.labels}
      load={load}
      rev={view}
      switcher={<ViewSwitch className="sf-views-stage" />}
      stops={RAIL}
      end={T.end}
      skip={{ href: '#stand-code', label: 'Skip', more: 'to the code' }}
      hero={
        <>
          <p className="sf-kicker">
            <span aria-hidden="true" /> Open-source TypeScript agent framework
          </p>
          <h1>
            Build agents you can <em>hold to the record.</em>
          </h1>
          <p className="sf-lede" key={view}>
            {copy.hero.lede}
          </p>
          <div className="sf-actions">
            <Link className="v2-button v2-button-quiet" href="#stand-code" prefetch={false}>
              See the code <span aria-hidden="true">↓</span>
            </Link>
          </div>
          <p className="sf-hint" aria-hidden="true">
            <span className="sf-steps">
              <i />
              <i />
            </span>
            Scroll to see how
          </p>
        </>
      }
      line={
        <p className="sf-line" aria-hidden="true">
          {LINE.map(({ text, on }) => (
            <Fragment key={text}>
              <span data-lit={on.join(' ')}>{text}</span>{' '}
            </Fragment>
          ))}
        </p>
      }
      caps={CHAPTER_IDS.map((id) => {
        const next = CHAPTER_NEXT[id];
        return {
          id,
          letter: CHAPTER_LETTER[id],
          h: copy.caps[id].h,
          s: copy.caps[id].s,
          next: next
            ? { text: `${copy.chain[next.line]!.verb} ${copy.chain[next.line]!.why}`, to: next.to }
            : undefined,
          extra:
            id === 'finale' ? (
              <div className="sf-actions">
                <Link className="v2-button v2-button-primary" href="#stand-code">
                  See the code <span aria-hidden="true">↓</span>
                </Link>
                <code className="sf-install">npm install agentfootprint</code>
              </div>
            ) : null,
        };
      })}
    />
  );
}
