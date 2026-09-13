import { createShikiFactory } from 'fumadocs-core/highlight/shiki';

// CodeFile currently renders TypeScript; the web bundle also covers its public
// JS/TSX/JSON language choices. Keep MDX/Twoslash's server factory unchanged.
// Fumadocs falls back to readable text for languages outside this catalog.
export const browserShikiFactory = createShikiFactory({
  async init(options) {
    const [{ createHighlighter }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/bundle/web'),
      import('shiki/engine/javascript'),
    ]);
    return createHighlighter({
      langs: [],
      themes: [],
      langAlias: options?.langAlias,
      engine: createJavaScriptRegexEngine(),
    });
  },
});
