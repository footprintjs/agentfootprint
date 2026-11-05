import Link from 'next/link';
import { LETTERS, PLACES, type Place, type Tile } from './standsCopy';

const TAG: Partial<Record<NonNullable<Tile['effect']>, string>> = {
  standing: 'moves the standing',
  finding: 'recorded only',
};

/** Odd segments between backticks are code. */
export function CodeText({ text }: { text: string }) {
  return <>{text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}</>;
}

function TileCard({ tile }: { tile: Tile }) {
  const tag = tile.effect ? TAG[tile.effect] : undefined;
  const body = (
    <>
      <span className="sg-tile-top">
        <strong>{tile.name}</strong>
        {tag ? <em className={`sg-tag is-${tile.effect}`}>{tag}</em> : null}
      </span>
      <span className="sg-tile-text">{tile.product}</span>
      <span className="sg-tile-tech">{tile.technical}</span>
      {tile.api ? <code>{tile.api}</code> : null}
    </>
  );
  return (
    <li>
      {tile.href ? (
        <Link className="sg-tile" href={tile.href} prefetch={false}>
          {body}
        </Link>
      ) : (
        <div className="sg-tile">{body}</div>
      )}
    </li>
  );
}

function PlaceTable({ place }: { place: Place }) {
  return (
    <div className="hs-place" id={place.id}>
      <h4>
        <span>{place.step}</span> {place.name}
      </h4>
      <p>{place.intro}</p>
      <table className="hs-table">
        <thead>
          <tr>
            <th scope="col">Check</th>
            <th scope="col">Compares</th>
            <th scope="col">Who decides</th>
            <th scope="col">What happens</th>
          </tr>
        </thead>
        <tbody>
          {place.rows.map((row) => (
            <tr key={row.check}>
              <th scope="row">
                {row.check}
                {row.api ? <code>{row.api}</code> : null}
              </th>
              <td data-label="Compares">{row.compares}</td>
              <td data-label="Who decides">{row.decides}</td>
              <td data-label="What happens">{row.then}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {place.note ? <p className="hs-note">{place.note}</p> : null}
    </div>
  );
}

/** STAND in order, with Assess told by the three places the model is involved. Plain HTML, so it can be read and indexed. */
export function StandGrid() {
  return (
    <section className="sg" id="stand" aria-labelledby="sg-title">
      <header className="sg-head">
        <p className="v2-kicker">The STAND pattern, letter by letter</p>
        <h2 id="sg-title">ReAct, the reason-and-act loop, is how an agent works. STAND is how its claims are held to the record.</h2>
      </header>
      {LETTERS.map((l) => (
        <article className="sg-letter" id={`stand-${l.letter.toLowerCase()}`} key={l.letter}>
          <div className="sg-big" aria-hidden="true">
            {l.letter}
          </div>
          <div className="sg-body">
            <h3>
              {l.verb} <small>{l.design}</small>
            </h3>
            <p className="sg-line">{l.line}</p>
            {l.letter === 'A' ? (
              PLACES.map((place) => <PlaceTable place={place} key={place.id} />)
            ) : (
              <ul className="sg-tiles">
                {l.tiles.map((tile) => (
                  <TileCard tile={tile} key={tile.name} />
                ))}
              </ul>
            )}
          </div>
        </article>
      ))}
      <p className="sg-key">
        <strong>Recorded only</strong> means the check files what it found and does not move the answer&rsquo;s standing
        today.
      </p>
    </section>
  );
}
