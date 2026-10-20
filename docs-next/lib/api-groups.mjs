import { headingEntries } from './heading-slugs.mjs';

export const API_GROUPS = [
  {
    slug: 'scope-events',
    title: 'Scope event payloads',
    members: ['CommitEvent', 'EmitEvent', 'ErrorEvent', 'ReadEvent', 'WriteEvent'],
  },
  {
    slug: 'flow-events',
    title: 'Flow event payloads',
    members: [
      'StageEvent',
      'FlowBreakEvent',
      'FlowDecisionEvent',
      'FlowErrorEvent',
      'FlowForkEvent',
      'FlowLoopEvent',
      'FlowNextEvent',
      'FlowSelectedEvent',
      'FlowStageEvent',
      'FlowSubflowEvent',
      'FlowSubflowRegisteredEvent',
    ],
  },
];

const apiRoute = (name) => `/docs/api/interfaces/${name}`;
/** Only generated, same-site destinations; an alias can never become an open redirect. */
export function validateApiAlias(alias) {
  if (
    !/^\/docs\/api\/interfaces\/[A-Za-z][A-Za-z0-9_]*$/.test(alias.from) ||
    !API_GROUPS.some(
      (group) => apiRoute(group.slug) === alias.to && group.members.includes(alias.anchor),
    ) ||
    alias.from !== apiRoute(alias.anchor) ||
    alias.target !== `interface-${alias.anchor.toLowerCase()}` ||
    !alias.fragments ||
    typeof alias.fragments !== 'object' ||
    Object.entries(alias.fragments).length > 512 ||
    Object.entries(alias.fragments).some(
      ([key, value]) =>
        !/^[-a-z0-9_]{1,256}$/.test(key) ||
        typeof value !== 'string' ||
        !/^[-a-z0-9_]{1,256}$/.test(value),
    )
  )
    throw new Error('Invalid generated API alias');
}

export function resolveApiAlias(url, aliases) {
  const [route, hash] = url.split('#', 2);
  const alias = aliases.find((entry) => entry.from === route.replace(/\/$/, ''));
  if (!alias) return url;
  validateApiAlias(alias);
  let fragment;
  try {
    fragment = decodeURIComponent(hash ?? '');
  } catch {
    fragment = '';
  }
  const target = Object.hasOwn(alias.fragments, fragment)
    ? alias.fragments[fragment]
    : alias.target;
  return `${alias.to}#${encodeURIComponent(target)}`;
}

/** Work outside fences only: examples remain byte-identical, even when they contain Markdown. */
function rewriteApiLinks(content, aliases, self = '') {
  let fence;
  return content
    .split('\n')
    .map((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker) {
        if (!fence) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
        return line;
      }
      if (fence) return line;
      return line.replace(
        /\]\((\/docs\/api\/[^)\s]+|#[^)\s]+)\)/g,
        (_match, url) => `](${resolveApiAlias(url.startsWith('#') ? self + url : url, aliases)})`,
      );
    })
    .join('\n');
}

/** One render per related group. The declaration prose and code are retained, never summarized. */
export function groupApiPages(input) {
  const pages = new Map(input);
  const aliases = [];
  const bodies = new Map();
  for (const group of API_GROUPS) {
    if (pages.has(`interfaces/${group.slug}.md`))
      throw new Error('API group destination collision');
    for (const name of group.members) {
      const key = `interfaces/${name}.md`;
      const original = pages.get(key);
      if (original === undefined) throw new Error(`API group declaration missing: ${name}`);
      const body = original.replace(/^---\n[\s\S]*?\n---\n/, '');
      const headings = headingEntries(body);
      aliases.push({
        from: apiRoute(name),
        to: apiRoute(group.slug),
        anchor: name,
        target: '',
        fragments: {},
      });
      bodies.set(name, { body, headings });
      pages.delete(key);
    }
  }
  for (const group of API_GROUPS) {
    const parts = group.members.map((name) => {
      const { body, headings } = bodies.get(name);
      const lines = new Set(
        headings.filter((entry) => !entry.explicit).map((entry) => entry.index),
      );
      const shifted = body
        .split('\n')
        .map((line, index) => (lines.has(index) ? line.replace(/^(#{1,5}) /, '$1# ') : line))
        .join('\n');
      bodies.get(name).shifted = shifted;
      return shifted;
    });
    const body = parts.join('\n\n---\n\n');
    // Use the renderer's native heading IDs. Raw HTML anchors in .md are discarded.
    // Slug the entire group so repeated headings receive the same suffixes as the renderer.
    const groupedHeadings = headingEntries(body);
    let offset = 0;
    for (const name of group.members) {
      const original = bodies.get(name).headings;
      const alias = aliases.find((entry) => entry.anchor === name);
      alias.target = groupedHeadings[offset].slug;
      alias.fragments = Object.fromEntries(
        original.map((entry, index) => [entry.slug, groupedHeadings[offset + index].slug]),
      );
      validateApiAlias(alias);
      offset += original.length;
    }
    pages.set(
      `interfaces/${group.slug}.md`,
      `---\ntitle: ${group.title}\ndescription: Related recorder payloads, with a section for each interface.\n---\n\n${body}`,
    );
  }
  for (const group of API_GROUPS) {
    const body = group.members
      .map((name) => rewriteApiLinks(bodies.get(name).shifted, aliases, apiRoute(name)))
      .join('\n\n---\n\n');
    pages.set(
      `interfaces/${group.slug}.md`,
      `---\ntitle: ${group.title}\ndescription: Related recorder payloads, with a section for each interface.\n---\n\n${body}`,
    );
  }
  for (const alias of aliases) {
    // Retain the individual raw-Markdown door for existing AI/document clients.
    alias.markdown = rewriteApiLinks(bodies.get(alias.anchor).body, aliases, alias.from);
  }
  for (const [key, content] of pages) pages.set(key, rewriteApiLinks(content, aliases));
  return { pages, aliases };
}
