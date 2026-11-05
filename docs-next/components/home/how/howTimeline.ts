/** When things happen in the How it works film, in beats. Small on purpose: the page imports it up front, and the engine loads later. */
export const H = {
  wrongA: 0.9,
  askA: 2.5,
  recordA: 3.9,
  walkA: 5.7,
  addressA: 7.9,
  suspectA: 10.0,
  rerunA: 11.3,
  forwardA: 13.4,
  loopA: 15.2,
  endA: 16.8,
  end: 18.4,
} as const;

export const HOW_CHAPTERS: readonly (readonly [string, number, number])[] = [
  ['hero', 0, 0.85],
  ['wrong', H.wrongA, H.askA - 0.05],
  ['ask', H.askA, H.recordA - 0.05],
  ['record', H.recordA, H.walkA - 0.05],
  ['walk', H.walkA, H.addressA - 0.05],
  ['address', H.addressA, H.suspectA - 0.05],
  ['suspect', H.suspectA, H.rerunA - 0.05],
  ['rerun', H.rerunA, H.forwardA - 0.05],
  ['forward', H.forwardA, H.loopA - 0.05],
  ['loop', H.loopA, H.endA - 0.05],
  ['end', H.endA, 1e9],
];

/** The film's five layers, on the scrubber. */
export const HOW_STOPS = [
  { label: '1', at: H.wrongA + 0.1, letter: true },
  { label: '2', at: H.recordA + 0.12, letter: true },
  { label: '3', at: H.walkA + 0.12, letter: true },
  { label: '4', at: H.addressA + 0.12, letter: true },
  { label: '5', at: H.rerunA + 0.12, letter: true },
] as const;

export const HOW_STILLS: Readonly<Record<string, number>> = {
  wrong: H.askA - 0.2,
  ask: H.recordA - 0.2,
  record: H.walkA - 0.2,
  walk: H.addressA - 0.2,
  address: H.suspectA - 0.2,
  suspect: H.rerunA - 0.2,
  rerun: H.forwardA - 0.2,
  forward: H.loopA - 0.2,
  loop: H.endA - 0.2,
  end: H.end,
};
