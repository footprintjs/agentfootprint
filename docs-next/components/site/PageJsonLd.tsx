import { pageJsonLd } from '@/lib/jsonld';

/** Structured data for one reading page. */
export function PageJsonLd(props: {
  readonly name: string;
  readonly description: string;
  readonly path: string;
}) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(pageJsonLd(props)).replace(/</g, '\\u003c'),
      }}
    />
  );
}
