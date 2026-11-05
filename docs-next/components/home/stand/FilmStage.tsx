'use client';

import { Fragment, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { FilmController } from './live';

/** One word per span, so a headline can rise into place. */
function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(' ').map((word, i) => (
        <Fragment key={`${word}-${i}`}>
          <span className="w">
            <span style={{ '--i': i } as CSSProperties}>{word}</span>
          </span>{' '}
        </Fragment>
      ))}
    </>
  );
}

export interface StageCap {
  readonly id: string;
  readonly letter?: string;
  readonly h: string;
  readonly s: string;
  readonly next?: { readonly text: string; readonly to?: string };
  readonly extra?: ReactNode;
}

export interface StageStop {
  readonly label: string;
  readonly at: number;
  readonly letter: boolean;
}

/**
 * The pinned film, for any film. The server renders the hero and every caption as
 * plain text in reading order, so crawlers and no-JS readers get the whole story; the
 * canvas takes over once the page hydrates.
 */
export function FilmStage<L>(props: {
  readonly id: string;
  readonly label: string;
  readonly labels: L;
  /** Loads the engine late, and hands back what starts it. */
  readonly load: () => Promise<(root: HTMLElement, labels: L) => FilmController<L> | null>;
  readonly hero: ReactNode;
  /** A line that heads the film once the hero has gone. Any `data-lit` inside lights for those chapters. */
  readonly line?: ReactNode;
  readonly caps: readonly StageCap[];
  readonly stops: readonly StageStop[];
  readonly end: number;
  readonly skip: { readonly href: string; readonly label: string; readonly more: string };
  readonly switcher?: ReactNode;
  /** Changes when the words change, so the headlines rise again. */
  readonly rev?: string;
  readonly className?: string;
}) {
  const { labels, load } = props;
  const root = useRef<HTMLElement>(null);
  const film = useRef<FilmController<L> | null>(null);
  const latest = useRef(labels);
  latest.current = labels;

  /* The engine loads after the page is up, so the hero's text never waits for it. */
  useEffect(() => {
    let cancelled = false;
    void load().then((start) => {
      if (cancelled || !root.current) return;
      film.current = start(root.current, latest.current);
    });
    return () => {
      cancelled = true;
      film.current?.destroy();
      film.current = null;
    };
  }, [load]);

  useEffect(() => {
    film.current?.setLabels(labels);
  }, [labels]);

  return (
    <section
      className={`sf${props.className ? ` ${props.className}` : ''}`}
      id={props.id}
      ref={root}
      aria-label={props.label}
    >
      <div className="sf-stage">
        <canvas className="sf-canvas" aria-hidden="true" />
        {props.switcher}
        {props.line}
        <div className="sf-hero on">{props.hero}</div>
        <ol className="sf-caps">
          {props.caps.map((cap) => (
            <li className="sf-cap" data-chapter={cap.id} key={cap.id}>
              {cap.letter ? (
                <span className="sf-badge" aria-hidden="true">
                  {cap.letter}
                </span>
              ) : null}
              <h2 key={props.rev}>
                <Words text={cap.h} />
              </h2>
              <p key={`${props.rev}-s`}>{cap.s}</p>
              {cap.next ? (
                <div className="sf-next" key={`${props.rev}-n`}>
                  <span>{cap.next.text}</span>
                  {cap.next.to ? <b aria-hidden="true">{cap.next.to}</b> : null}
                </div>
              ) : null}
              {cap.extra}
            </li>
          ))}
        </ol>
        <div className="sf-rail">
          <button
            type="button"
            className="sf-play"
            data-film-play
            data-play-idle="Play"
            aria-pressed="false"
          >
            <span className="sf-play-icon" aria-hidden="true" />
            <span data-play-label>Play</span>
          </button>
          <div className="sf-track">
            <div className="sf-track-line">
              <div className="sf-track-fill" />
            </div>
            {props.stops.map((stop) => (
              <button
                type="button"
                key={stop.label}
                className={`sf-stop${stop.letter ? ' is-letter' : ''}`}
                data-at={stop.at}
                style={{ left: `${((stop.at / props.end) * 100).toFixed(2)}%` }}
                aria-label={`Jump to ${stop.label}`}
              >
                <span>{stop.label}</span>
              </button>
            ))}
          </div>
          <a className="sf-skip" href={props.skip.href}>
            {props.skip.label}
            <span className="sf-skip-more"> {props.skip.more}</span>{' '}
            <span aria-hidden="true">↓</span>
          </a>
        </div>
      </div>
    </section>
  );
}
