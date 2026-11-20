/** Join actual public CJS/ESM mock-run reports to independently admitted inputs and entries. */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export function assertPublicProducerReports(evidence, inputs, graphs) {
  const reports = [];
  const consumers = evidence.cases.filter((item) => item.caseId.startsWith('consumer-'));
  assert.deepEqual(consumers.map((row) => row.caseId), ['consumer-online', 'consumer-offline']);
  for (const row of consumers) {
    for (const [command, format] of [['packed-cjs', 'cjs'], ['packed-esm', 'esm']]) {
      const record = row.commands.find((item) => item.command === command);
      assert(record?.execution?.exitCode === 0 && record.execution.signal === null);
      const lines = record.stdout.split('\n').filter((line) => line.startsWith('af-public-producer '));
      assert.equal(lines.length, 1, 'exactly one actual public producer report required');
      const report = JSON.parse(lines[0].slice('af-public-producer '.length));
      assert.deepEqual(Object.keys(report).sort(), ['entries', 'format', 'producer']);
      assert.equal(report.format, format);
      assert.deepEqual(report.producer, { agentfootprintVersion: inputs.source.version, footprintjsVersion: inputs.selected.footprintjs.version });
      const entries = graphs[row.caseId].agentfootprint.entries[format];
      const expected = Object.fromEntries(Object.entries(entries).map(([name, file]) => [name, format === 'esm' ? pathToFileURL(file).href : file]));
      assert.deepEqual(report.entries, expected, 'public entry must belong to the admitted installed archive');
      reports.push({ caseId: row.caseId, ...report });
    }
  }
  assert.equal(reports.length, 4, 'both public formats in both independent consumer roots');
  return reports;
}
