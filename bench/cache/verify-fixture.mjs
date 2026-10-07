/**
 * bench/cache/verify-fixture.mjs — the stable reference table `verify-haiku.mjs` serves.
 *
 * Deterministic text, long enough (~7,000 tokens) to clear Haiku 4.5's 4,096-token prompt-caching
 * minimum on its own: a prompt shorter than the minimum is never cached, marker or not, and a
 * check run on one would report a miss the library did not cause.
 */
const SITES = ['north', 'south', 'east', 'west', 'harbor', 'ridge', 'valley', 'summit'];
const REGIONS = ['eu-west', 'eu-central', 'us-east', 'us-west', 'ap-south', 'ap-east'];
const STATES = ['green', 'amber', 'green', 'green', 'red', 'green'];

/** 250 rows, one relay each, every field a pure function of the row number. */
export function lookupTable() {
  const rows = ['key | relay | owner | region | capacity | installed | status | note'];
  for (let i = 1; i <= 250; i += 1) {
    const key = `k${String(i).padStart(3, '0')}`;
    const relay = `${SITES[i % SITES.length]}-${String((i * 7) % 97).padStart(2, '0')}`;
    const owner = `team-${String((i * 13) % 41).padStart(2, '0')}`;
    const region = REGIONS[i % REGIONS.length];
    const capacity = `${10 * (1 + (i % 8))} Gb/s`;
    const month = String(1 + (i % 12)).padStart(2, '0');
    const day = String(1 + (i % 28)).padStart(2, '0');
    const status = STATES[i % STATES.length];
    rows.push(
      `${key} | ${relay} | ${owner} | ${region} | ${capacity} | 2024-${month}-${day} | ${status} | ` +
        `fed by ${SITES[(i + 3) % SITES.length]} trunk ${i % 5}, failover to ${relay}-b`,
    );
  }
  return rows.join('\n');
}
