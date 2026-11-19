// Locate a terminal candidate. The same public schema reader validates it.
export function terminalAnswerText(raw) {
  const text = raw.trimEnd();
  let open;
  for (const line of text.matchAll(/^[ \t]*(`{3,}|~{3,})([^\r\n]*)\r?$/gm)) {
    const [, marker, rest] = line;
    if (open === undefined) {
      open = line;
    } else if (marker[0] === open[1][0] && marker.length >= open[1].length && !rest.trim()) {
      if (line.index + line[0].length === text.length) {
        return text.slice(0, open.index).trim() ? text.slice(open.index) : undefined;
      }
      open = undefined;
    }
  }
  // A bare suffix inside an open fence is still part of that code block.
  if (open !== undefined || !text.endsWith('}')) return undefined;

  let depth = 0;
  let inString = false;
  for (let i = text.length - 1; i >= 0; i--) {
    const char = text[i];
    if (char === '"') {
      let escaped = false;
      for (let j = i - 1; text[j] === '\\'; j--) escaped = !escaped;
      if (!escaped) inString = !inString;
    }
    if (inString) continue;
    if (char === '}') depth++;
    if (char !== '{') continue;
    depth--;
    if (depth !== 0) continue;
    const prefix = text.slice(0, i);
    const separated = /(?:[.!?][ \t]+|\n[ \t]*)$/.test(prefix);
    return separated && prefix.trim() ? text.slice(i) : undefined;
  }
  return undefined;
}
