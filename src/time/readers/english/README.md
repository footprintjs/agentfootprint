# English zone tokens

The English reader facade owns tokenization. `types.ts` is its existing Atom
shape; `zones.ts` is the whole zone-token grammar and attachment unit moved here.
These files import only each other or the TimeReader port, never a resolver,
clock, app, model or time-zone implementation. The reader preserves a token; the
resolver decides its meaning. Bare range-side numbers remain ineligible, while
elapsed duration spans retain the stated zone and complete phrase.

The facade remains an oversized baseline and shrinks in this change; unrelated
grouping/phrase logic is unchanged. The concrete sealed import fence and ordinary
reader controls remain in `test/time/english-reader.test.ts`; duration-zone
behavior is also covered by `src/time/resolve/lookback.test.ts`. No test result is
claimed by this README.
