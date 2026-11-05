import fs from 'node:fs';
import { extractRegion } from '@/lib/regionExtractor';
import { CopyCode } from './CopyCode';

/**
 * A code block read from a file the tests run, so the page cannot drift from what ran. A missing
 * file or region fails the build. Runs at build time, so it stays out of client components.
 */
export function SampleCode({
  file,
  region = 'code',
  marks = [],
  title,
}: {
  /** relative to docs-next */
  readonly file: string;
  readonly region?: string;
  /** a line containing any of these is highlighted */
  readonly marks?: readonly string[];
  readonly title?: string;
}) {
  const source = fs.readFileSync(`${process.cwd()}/${file}`, 'utf-8');
  const lines = extractRegion(source, region, file)
    .code.split('\n')
    .filter((line) => !line.includes('@ts-expect-error'));
  return (
    <figure className="rp-code">
      {title ? <figcaption>{title}</figcaption> : null}
      <CopyCode code={lines.join('\n')} />
      <pre className="sc-code" tabIndex={0}>
        <code>
          {lines.map((line, i) => (
            <span
              className={`sc-line${marks.some((mark) => line.includes(mark)) ? ' is-mark' : ''}`}
              key={i}
            >
              {line || ' '}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}
