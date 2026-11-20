import type { KeyboardEvent } from 'react';

export function keyboardSubflowMount(
  event: KeyboardEvent<HTMLElement>,
  subflowMounts: ReadonlySet<string | undefined>,
): string | undefined {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const node = event.target;
  if (!(node instanceof HTMLElement) || !node.matches('.react-flow__node')) return;
  const id = node.dataset.id;
  if (!id || !subflowMounts.has(id)) return;

  // React Flow selects the node on these keys. Open the mount as a click would.
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.focus();
  return id;
}
