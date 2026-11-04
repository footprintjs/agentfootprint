// Measurement only. Prints the same absolute phase totals under Vitest 4 and
// Vitest 5. Vitest 5's summary line shows shares instead of times, and it no
// longer counts transform waits inside "import", so the two summary lines
// cannot be compared directly.
const MAX_FAILURE_LINES = 400;

const seconds = (ms) => Number((ms / 1000).toFixed(2));
const firstLine = (text) => String(text ?? '').split('\n')[0].slice(0, 220);

export default class PhaseReporter {
  onInit() {
    this.startedAt = Date.now();
  }

  onTestRunEnd(modules, unhandledErrors) {
    const sum = (read) => modules.reduce((total, module) => total + (read(module) || 0), 0);
    const counts = {};
    const failures = [];
    for (const module of modules) {
      const moduleErrors = module.errors();
      if (module.state() === 'failed' && moduleErrors.length > 0) {
        failures.push({
          file: module.relativeModuleId,
          name: '(module)',
          error: firstLine(moduleErrors[0]?.message),
        });
      }
      for (const test of module.children.allTests()) {
        const result = test.result();
        counts[result.state] = (counts[result.state] ?? 0) + 1;
        if (result.state === 'failed') {
          failures.push({
            file: module.relativeModuleId,
            name: test.fullName,
            error: firstLine(result.errors?.[0]?.message),
          });
        }
      }
    }
    const phases = {
      wall: seconds(Date.now() - this.startedAt),
      collect: seconds(sum((m) => m.diagnostic().collectDuration)),
      fetchWait: seconds(sum((m) => (m.task?.collectFetchDuration ?? 0) + (m.task?.setupFetchDuration ?? 0))),
      setup: seconds(sum((m) => m.diagnostic().setupDuration)),
      tests: seconds(sum((m) => m.diagnostic().duration)),
      environment: seconds(sum((m) => m.diagnostic().environmentSetupDuration)),
      prepare: seconds(sum((m) => m.diagnostic().prepareDuration)),
      files: modules.length,
      counts,
      unhandled: unhandledErrors.length,
    };
    console.log(`MEASURE phases ${JSON.stringify(phases)}`);
    for (const failure of failures.slice(0, MAX_FAILURE_LINES)) {
      console.log(`MEASURE failure ${JSON.stringify(failure)}`);
    }
    if (failures.length > MAX_FAILURE_LINES) {
      console.log(`MEASURE failure-lines-truncated total=${failures.length}`);
    }
  }
}
