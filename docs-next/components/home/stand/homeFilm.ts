import type { FilmLabels } from './copy';
import { Film } from './film';
import { bootFilm } from './live';
import { CHAPTERS, STILLS, T } from './timeline';

/** The STAND film on the home page. Its own file so the page loads it, and the engine, late. */
export const bootHomeFilm = (root: HTMLElement, labels: FilmLabels) =>
  bootFilm(root, labels, {
    make: (canvas, l) => new Film(canvas, l),
    end: T.end,
    chapters: CHAPTERS,
    stills: STILLS,
  });
