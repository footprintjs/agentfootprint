import Link from 'next/link';
import {
  ADAPTER_PAGES,
  ADAPTER_ROWS,
  SESSION_STORES_PAGE,
  adapterName,
  type AdapterCell,
} from '@/lib/features/adapters';

const PLACES = [
  ['aws', 'AWS'],
  ['google', 'Google Cloud'],
  ['azure', 'Azure'],
  ['local', 'Your machines'],
] as const;

function Name({ cell }: { cell: AdapterCell }) {
  return (
    <span className="pf-adapter">
      <code>{adapterName(cell)}</code>
      {typeof cell === 'string' ? null : <small>{cell.note}</small>}
    </span>
  );
}

/** Where each port has an adapter today. An empty cell is the point: that is where you write one. */
export function AdapterTable() {
  return (
    <div className="pf-adapters">
      <div className="pf-adapters-scroll">
        <table className="hs-table">
          <thead>
            <tr>
              <th scope="col">It touches</th>
              {PLACES.map(([key, label]) => (
                <th scope="col" key={key}>
                  {label}
                </th>
              ))}
              <th scope="col">Or write your own</th>
            </tr>
          </thead>
          <tbody>
            {ADAPTER_ROWS.map((row) => (
              <tr key={row.port}>
                <th scope="row">{row.port}</th>
                {row.everywhere ? (
                  <td colSpan={PLACES.length} data-label="Wherever it runs">
                    <Name cell={row.everywhere} />{' '}
                    <span className="pf-anywhere">wherever the agent runs</span>
                  </td>
                ) : (
                  PLACES.map(([key, label]) => (
                    <td data-label={label} key={key}>
                      {row[key]?.length ? (
                        row[key].map((cell) => <Name cell={cell} key={adapterName(cell)} />)
                      ) : (
                        <span className="pf-none">none yet</span>
                      )}
                    </td>
                  ))
                )}
                <td data-label="Or write your own">
                  {row.yours.map((name) => (
                    <Name cell={name} key={name} />
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hs-note">
        A recipe is a documented setup, not a dedicated adapter. The full map for each place:{' '}
        {ADAPTER_PAGES.map((page, i) => (
          <span key={page.href}>
            <Link href={page.href} prefetch={false}>
              {page.label}
            </Link>
            {i < ADAPTER_PAGES.length - 1 ? ', ' : '. '}
          </span>
        ))}
        A session store you write can be tested with{' '}
        <Link href={SESSION_STORES_PAGE} prefetch={false}>
          <code>runSessionLifecycleConformance</code>
        </Link>
        .
      </p>
    </div>
  );
}
