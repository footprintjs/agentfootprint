#!/bin/sh
# Minified and gzipped browser bundle of each reader (esbuild --platform=browser). Run from time-eval/.
set -e
mkdir -p bundle
printf "export { recognizeDateTime, Culture, DateTimeOptions } from '@microsoft/recognizers-text-date-time';\n" > bundle/rec.mjs
printf "export { parse } from 'chrono-node';\n" > bundle/chrono.mjs
printf "export { englishTimeReader } from '../.build/af-english.mjs';\n" > bundle/af.mjs
# the grammar prototype: the leftover scan, the closed grammar, and the grammar reader (copied out of adapters.mjs)
sed -n '/^\/\/ ─── The closed lookback grammar as a reader/,/^\/\/ ─── agentfootprint englishTimeReader/p' scripts/adapters.mjs | sed '$d' \
  | sed "s#'./signals.mjs'#'../scripts/signals.mjs'#" > bundle/grammar-reader.mjs
printf "export { scan, readLookbackQuote } from '../scripts/signals.mjs';\nexport { libraryGrammar } from './grammar-reader.mjs';\n" > bundle/grammar.mjs
for b in rec chrono af grammar; do
  ./node_modules/.bin/esbuild bundle/$b.mjs --bundle --minify --format=esm --platform=browser --outfile=bundle/$b.min.js --log-level=error
  printf "%-8s minified %8s B   gzip %8s B\n" $b "$(wc -c < bundle/$b.min.js | tr -d ' ')" "$(gzip -9 -c bundle/$b.min.js | wc -c | tr -d ' ')"
done
