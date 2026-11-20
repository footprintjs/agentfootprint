/**
 * Fumadocs emits a separate browser-side record for the description, each
 * heading, and each body fragment. Keep all of that text in one record per
 * guide. The search dialog presents the parent page for any matching term.
 *
 * @param {import('fumadocs-core/search/server').AdvancedIndex} index
 * @returns {import('fumadocs-core/search/server').AdvancedIndex}
 */
export function compactGuideIndex({ description, structuredData, ...page }) {
  const content = [
    description,
    ...structuredData.headings.map((heading) => heading.content),
    ...structuredData.contents.map((entry) => entry.content),
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    ...page,
    structuredData: {
      headings: [],
      contents: content ? [{ heading: undefined, content }] : [],
    },
  };
}
