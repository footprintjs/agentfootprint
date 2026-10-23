/**
 * language — whether a unit is English, over a CLOSED stop-word set. The grammar is English
 * only; a unit in another language is noted `language-unsupported`, never passed silently.
 *
 * Pattern: a count, not a model. A unit is unsupported when it is mostly letters of a non-Latin
 *          script, or when one other language's stop words outnumber the English ones (and at
 *          least two of them are there). The foreign lists hold no word that is also common
 *          English (`die`, `den`, `per`, `con`, `as`, `on` are left out), so an English sentence
 *          naming "the San José cluster" stays English.
 * Role:    integrity/ layer (L3), read by `detect.ts`.
 */

import type { Token } from './matcher.js';

const ENGLISH = new Set(
  (
    'the a an is are was were be been there no not none nothing has have had do does did of to ' +
    'and or in on at for with by from any this that these those it its all every found exist ' +
    'exists open i we you they our your their'
  ).split(' '),
);

const FOREIGN: Readonly<Record<string, ReadonlySet<string>>> = {
  es: new Set(
    'hay los las el del una unos unas para por que está están ningún ninguna ninguno nada existe en sin también pero sí abiertos abiertas'.split(
      ' ',
    ),
  ),
  fr: new Set(
    "les des est sont une aucun aucune pas il elle avec pour dans sur ce cette qui du au aux rien n'y y ouvert ouverte".split(
      ' ',
    ),
  ),
  de: new Set(
    'der das und ist sind nicht kein keine keinen ein eine einen mit für auf es gibt nichts dem zu offenen'.split(
      ' ',
    ),
  ),
  pt: new Set('não há os um uma nenhum nenhuma são existem também abertos'.split(' ')),
  it: new Set('il gli non sono è nessun nessuna ci della delle aperti'.split(' ')),
  nl: new Set('het een niet geen zijn er voor ook'.split(' ')),
};

/** Whether a unit can be read by the English grammar. */
export function isSupportedLanguage(unitText: string, tokens: readonly Token[]): boolean {
  const letters = unitText.match(/\p{L}/gu)?.length ?? 0;
  const latin = unitText.match(/\p{Script=Latin}/gu)?.length ?? 0;
  if (letters - latin >= 3 && letters - latin > latin) return false;
  let english = 0;
  const foreign: Record<string, number> = {};
  for (const token of tokens) {
    if (ENGLISH.has(token.text)) english += 1;
    for (const [language, words] of Object.entries(FOREIGN)) {
      if (words.has(token.text)) foreign[language] = (foreign[language] ?? 0) + 1;
    }
  }
  const most = Math.max(0, ...Object.values(foreign));
  return !(most >= 2 && most > english);
}
