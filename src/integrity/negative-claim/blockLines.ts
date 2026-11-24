type Container = number | 'quote';

type BlockLine =
  | { readonly kind: 'prose'; readonly body: string }
  | { readonly kind: 'fence' | 'code' };

const QUOTE = /^ {0,3}> ?/u;
const LIST = /^( {0,3})([-+*]|\d{1,9}[.)])(?:( {1,4})(?=\S)| *$)/u;
const FENCE = /^ {0,3}(\x60{3,}|~{3,})(.*)$/su;
const BLANK = /^ *$/u;
const NON_PARAGRAPH =
  /^ {0,3}(?:#{1,6}(?: |$)|(?:\* *){3,}$|(?:- *){3,}$|(?:_ *){3,}$|[=-]+ *$|<)/u;

function beginsParagraph(body: string): boolean {
  return !BLANK.test(body) && !body.startsWith('    ') && !NON_PARAGRAPH.test(body);
}

/** Tabs affect block indentation only. Original offsets stay with the caller. */
function expandTabs(text: string): string {
  if (!text.includes('\t')) return text;
  let result = '';
  for (let index = 0; index < text.length; index++) {
    result += text[index] === '\t' ? ' '.repeat(4 - (result.length % 4)) : text[index];
  }
  return result;
}

/** Classify fences at their container's indentation, including the opening and closing lines. */
export function blockLines(): (line: string) => BlockLine {
  const containers: Container[] = [];
  let fence: string | undefined;
  let paragraph = false;

  return (line) => {
    let body = expandTabs(line);
    let depth = 0;
    for (const container of containers) {
      if (container === 'quote') {
        const continuation = QUOTE.exec(body);
        if (continuation === null) break;
        body = body.slice(continuation[0].length);
      } else if (!body.startsWith(' '.repeat(container))) {
        if (!BLANK.test(body)) break;
      } else {
        body = body.slice(container);
      }
      depth++;
    }
    if (fence !== undefined && depth === containers.length) {
      const close = FENCE.exec(body);
      if (
        close !== null &&
        close[1][0] === fence[0] &&
        close[1].length >= fence.length &&
        BLANK.test(close[2])
      ) {
        fence = undefined;
        paragraph = false;
        return { kind: 'fence' };
      }
      return { kind: 'code' };
    }
    const endedFence = fence !== undefined;
    fence = undefined;
    // Plain continuation lines may omit list indentation. Keep their container
    // available to a later indented fence unless a new block has begun.
    if (
      !endedFence &&
      paragraph &&
      depth < containers.length &&
      beginsParagraph(body) &&
      !FENCE.test(body) &&
      !QUOTE.test(body) &&
      !LIST.test(body)
    )
      return { kind: 'prose', body };

    containers.length = depth;
    for (;;) {
      const quote = QUOTE.exec(body);
      if (quote !== null) {
        containers.push('quote');
        body = body.slice(quote[0].length);
        continue;
      }
      const item = LIST.exec(body);
      if (item === null) break;
      containers.push(item[1].length + item[2].length + (item[3]?.length ?? 1));
      body = body.slice(item[0].length);
    }
    const open = FENCE.exec(body);
    paragraph = open === null && beginsParagraph(body);
    if (open === null) return { kind: 'prose', body };
    fence = open[1];
    return { kind: 'fence' };
  };
}
