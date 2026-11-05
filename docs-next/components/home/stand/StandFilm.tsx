'use client';

import Link from 'next/link';
import { Fragment, useEffect, useRef } from 'react';
import { CHAPTER_IDS, CHAPTER_LETTER, CHAPTER_NEXT, COPY } from './copy';
import type { FilmController } from './live';
import { RAIL, T } from './timeline';
import { useStandView, ViewSwitch } from './StandView';

/** One word per span, so a headline can rise into place. */
function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(' ').map((word, i) => (
        <Fragment key={`${word}-${i}`}>
          <span className="w">
            <span style={{ '--i': i } as React.CSSProperties}>{word}</span>
          </span>{' '}
        </Fragment>
      ))}
    </>
  );
}

/**
 * The film at the top of the homepage. The server renders the hero and every
 * caption as plain text in reading order, so crawlers and no-JS readers get the
 * whole story; the canvas takes over once the page hydrates.
 */
export function StandFilm() {
  const { view } = useStandView();
  const root = useRef<HTMLElement>(null);
  const film = useRef<FilmController | null>(null);
  const copy = COPY[view];

  const latest = useRef(copy);
  latest.current = copy;

  /* The engine loads after the page is up, so the hero's text never waits for it. */
  useEffect(() => {
    let cancelled = false;
    void import('./live').then(({ bootFilm }) => {
      if (cancelled || !root.current) return;
      film.current = bootFilm(root.current, latest.current.labels);
    });
    return () => {
      cancelled = true;
      film.current?.destroy();
      film.current = null;
    };
  }, []);

  useEffect(() => {
    film.current?.setLabels(copy.labels);
  }, [copy]);

  return (
    <section className="sf" id="stand-film" ref={root} aria-label="The STAND pattern, as a film">
      <div className="sf-stage">
        <canvas className="sf-canvas" aria-hidden="true" />
        <ViewSwitch className="sf-views-stage" />
        <div className="sf-hero on">
          <p className="sf-kicker">
            <span aria-hidden="true" /> Open-source TypeScript agent framework
          </p>
          <h1>
            Build agents you can <em>hold to the record.</em>
          </h1>
          <p className="sf-tag">The model can say anything. The record shows what it rests on.</p>
          <p className="sf-lede" key={view}>
            {copy.hero.lede}
          </p>
          <div className="sf-actions">
            <button type="button" className="v2-button v2-button-primary" data-film-play data-play-idle="Play the film">
              <span data-play-label>Play the film</span>
            </button>
            <Link className="v2-button v2-button-quiet" href="#stand-code" prefetch={false}>
              See the code <span aria-hidden="true">↓</span>
            </Link>
          </div>
          <p className="sf-hint" aria-hidden="true">
            <span className="sf-mouse" /> Scroll to play it
          </p>
        </div>
        <ol className="sf-caps">
          {CHAPTER_IDS.map((id) => {
            const cap = copy.caps[id];
            const letter = CHAPTER_LETTER[id];
            const next = CHAPTER_NEXT[id];
            return (
              <li className="sf-cap" data-chapter={id} key={id}>
                {letter ? (
                  <span className="sf-badge" aria-hidden="true">
                    {letter}
                  </span>
                ) : null}
                <h2 key={view}>
                  <Words text={cap.h} />
                </h2>
                <p key={`${view}-s`}>{cap.s}</p>
                {next ? (
                  <div className="sf-next" key={`${view}-n`}>
                    <span>
                      {copy.chain[next.line]!.verb} {copy.chain[next.line]!.why}
                    </span>
                    {next.to ? <b aria-hidden="true">{next.to}</b> : null}
                  </div>
                ) : null}
                {id === 'finale' ? (
                  <div className="sf-actions">
                    <Link className="v2-button v2-button-primary" href="#stand-code">
                      See the code <span aria-hidden="true">↓</span>
                    </Link>
                    <code className="sf-install">npm install agentfootprint</code>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
        <div className="sf-rail">
          <button type="button" className="sf-play" data-film-play data-play-idle="Play" aria-pressed="false">
            <span className="sf-play-icon" aria-hidden="true" />
            <span data-play-label>Play</span>
          </button>
          <div className="sf-track">
            <div className="sf-track-line">
              <div className="sf-track-fill" />
            </div>
            {RAIL.map((stop) => (
              <button
                type="button"
                key={stop.label}
                className={`sf-stop${stop.letter ? ' is-letter' : ''}`}
                data-at={stop.at}
                style={{ left: `${((stop.at / T.end) * 100).toFixed(2)}%` }}
                aria-label={`Jump to ${stop.label}`}
              >
                <span>{stop.label}</span>
              </button>
            ))}
          </div>
          <a className="sf-skip" href="#stand-code">
            Skip<span className="sf-skip-more"> to the code</span> <span aria-hidden="true">↓</span>
          </a>
        </div>
      </div>
    </section>
  );
}
