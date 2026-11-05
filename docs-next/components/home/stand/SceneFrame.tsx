'use client';

import { useEffect, useRef } from 'react';
import type { FilmEngine } from './live';
import type { ScenePlayer } from './scenePlayer';

/**
 * A small scene beside the text it illustrates. The text carries the meaning, so without
 * JavaScript the frame is simply absent. Nothing loads until the scene is nearly on screen.
 */
export function SceneFrame<L>(props: {
  readonly load: () => Promise<(canvas: HTMLCanvasElement, labels: L) => FilmEngine<L>>;
  readonly labels: L;
  readonly from: number;
  readonly to: number;
}) {
  const { labels, load, from, to } = props;
  const root = useRef<HTMLDivElement>(null);
  const player = useRef<ScenePlayer<L> | null>(null);
  const latest = useRef(labels);
  latest.current = labels;

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let cancelled = false;
    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        near.disconnect();
        void Promise.all([import('./scenePlayer'), load()]).then(([{ ScenePlayer: Player }, make]) => {
          const canvas = el.querySelector('canvas');
          if (cancelled || !canvas) return;
          player.current = new Player(el, make(canvas, latest.current), { from, to });
        });
      },
      { rootMargin: '400px 0px' },
    );
    near.observe(el);
    return () => {
      cancelled = true;
      near.disconnect();
      player.current?.destroy();
      player.current = null;
    };
  }, [load, from, to]);

  useEffect(() => {
    player.current?.setLabels(labels);
  }, [labels]);

  return (
    <div className="sfr" ref={root}>
      <canvas aria-hidden="true" />
      <button type="button" className="sfr-replay" data-scene-replay aria-label="Play this scene again">
        <span aria-hidden="true">↻</span> Replay
      </button>
    </div>
  );
}
