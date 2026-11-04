#!/usr/bin/env bash
# Measurement only. Runs one Vitest pass in a checkout and prints one MEASURE
# line with wall time and how many files the module cache gained. A failing
# pass does not stop the job: the failures are the data.
# Usage: run.sh <label> <checkout> [vitest args...]
set -u
label=$1
tree=$2
shift 2
cd "$tree" || exit 1
cache=node_modules/.vitest-cache
count_files() { find "$cache" -type f 2>/dev/null | wc -l | tr -d ' '; }
before=$(count_files)
start=$(date +%s.%N)
npx vitest run --reporter=default --reporter="$PWD/node_modules/.measure/phase-reporter.mjs" "$@"
status=$?
end=$(date +%s.%N)
after=$(count_files)
size=$(du -sh "$cache" 2>/dev/null | cut -f1 | tr -d ' ')
metadata=$(tr -d ' \n' < "$cache/_metadata.json" 2>/dev/null)
wall=$(awk -v a="$start" -v b="$end" 'BEGIN { printf "%.1f", b - a }')
echo "MEASURE run label=$label wall_seconds=$wall exit=$status cache_files_before=$before cache_files_after=$after cache_size=${size:-none} cache_metadata=${metadata:-none}"
exit 0
