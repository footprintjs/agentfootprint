const field = (name, value, source, alternatives) =>
  Object.freeze({ name, value, source, ...(alternatives && { alternatives: Object.freeze(alternatives) }) });

const sources = Object.freeze({
  juniper: Object.freeze(['Code: QX41', 'Shelf: Teal', 'Copies: 17']),
  alder: Object.freeze(['Depot: Larch', 'Bins: 31']),
  birch: Object.freeze(['Route: Quartz', 'Crates: 64']),
  register: Object.freeze(['Capacity: 29']),
  estimate: Object.freeze(['Capacity: 72']),
});

const families = [
  ['one-source', ['juniper'], [
    field('Code', 'QX41', 'juniper'), field('Shelf', 'Teal', 'juniper'),
    field('Copies', '17', 'juniper'),
  ]],
  ['two-sources', ['alder', 'birch'], [
    field('Depot', 'Larch', 'alder'), field('Bins', '31', 'alder'),
    field('Route', 'Quartz', 'birch'), field('Crates', '64', 'birch'),
  ]],
  ['decoy', ['register', 'estimate'], [
    field('Capacity', '29', 'register', ['72']),
  ], 'Use the capacity from the register. The estimate is a different source.'],
];

function makeTask([family, order, fields, selection], side) {
  const reverse = side === 'b';
  const handles = Object.fromEntries(order.map((source, index) =>
    [source, `r${reverse && order.length === 1 ? 2 : 1 + index}`]));
  const lookups = reverse ? [...order].reverse() : [...order];
  return Object.freeze({
    family, side,
    fields: Object.freeze(fields),
    lookups: Object.freeze(lookups),
    results: Object.freeze(Object.fromEntries(lookups.map((source) => [source, Object.freeze({
      handle: handles[source], content: (reverse && order.length === 1 ? [...sources[source]].reverse() : sources[source]).join('\n'),
    })]))),
    message: [
      `Read the catalog sources in this order: ${lookups.join(', ')}.`,
      selection,
      `Report these fields: ${fields.map(({ name }) => name).join(', ')}.`,
    ].filter(Boolean).join(' '),
  });
}

export const tasks = Object.freeze(families.flatMap((family) =>
  ['a', 'b'].map((side) => makeTask(family, side))));

export const arms = Object.freeze(['ordinary', 'citation']);

export function systemPrompt(arm) {
  return [
    'You operate a small catalog desk. Use the provided read-only lookup before answering.',
    'Return one line per requested field in the form Field: value. Keep the result values verbatim.',
    ...(arm === 'citation' ? ['After each value, write its source handle in brackets, like [r1]. Use the handle attached to that lookup result.'] : []),
  ].join('\n');
}
