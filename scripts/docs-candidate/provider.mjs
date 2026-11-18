/** Fresh primary metadata must still describe the admitted original bytes. */
import assert from 'node:assert/strict';

export function validateProvider(selected, actual) {
  assert.equal(actual.source?.sha, selected.source.head, 'docs-input-source-head');
  assert.equal(actual.source?.tree?.sha, selected.source.tree, 'docs-input-source-tree');
  assert.equal(actual.tested?.sha, selected.tested.head, 'docs-input-tested-head');
  assert.equal(actual.tested?.tree?.sha, selected.source.tree, 'docs-input-tested-tree');
  assert.deepEqual(actual.tested?.parents?.map((p) => p.sha), selected.tested.parents,
    'docs-input-tested-parents');
  assert.equal(actual.runs?.length, selected.runs.length, 'docs-input-runs');
  for (const expected of selected.runs) {
    const item = actual.runs.find(({ run }) => run.id === expected.id);
    assert(item, 'docs-input-missing-run');
    const { run, jobs } = item;
    for (const key of ['id', 'workflow_id', 'run_attempt', 'head_branch', 'event', 'conclusion']) {
      assert.deepEqual(run[key], expected[key], `docs-input-run-${key}`);
    }
    assert.equal(run.status, 'completed', 'docs-input-run-status');
    assert.equal(run.head_sha, selected.source.head, 'docs-input-run-head');
    assert.equal(run.repository?.id, selected.repositoryId, 'docs-input-run-repository');
    assert.equal(run.repository?.full_name, selected.repository, 'docs-input-run-repository');
    assert.equal(run.repository?.private, false, 'docs-input-public-repository');
    assert.equal(run.head_commit?.id, selected.source.head, 'docs-input-run-commit');
    assert.equal(run.head_commit?.tree_id, selected.source.tree, 'docs-input-run-tree');
    assert.equal(jobs?.total_count, expected.jobs.length, 'docs-input-job-count');
    assert.equal(jobs?.jobs?.length, expected.jobs.length, 'docs-input-job-count');
    assert.equal(new Set(jobs.jobs.map((j) => j.id)).size, expected.jobs.length,
      'docs-input-duplicate-jobs');
    for (const gate of expected.jobs) {
      const job = jobs.jobs.find((j) => j.id === gate.id);
      assert(job, 'docs-input-missing-job');
      assert.equal(job.name, gate.name, 'docs-input-job-name');
      assert.equal(job.status, 'completed', 'docs-input-job-status');
      assert.equal(job.conclusion, gate.conclusion, 'docs-input-job-conclusion');
      assert.equal(job.run_id, expected.id, 'docs-input-job-run');
      assert.equal(job.run_attempt, expected.run_attempt, 'docs-input-job-attempt');
      assert.equal(job.head_sha, selected.source.head, 'docs-input-job-head');
    }
  }
  const artifact = actual.artifact;
  for (const [key, value] of Object.entries({ id: selected.artifact.id,
    name: selected.artifact.name, size_in_bytes: selected.artifact.bytes,
    digest: `sha256:${selected.artifact.sha256}`, expired: false })) {
    assert.deepEqual(artifact?.[key], value, `docs-input-artifact-${key}`);
  }
  const run = selected.runs.find((r) => r.id === selected.artifact.runId);
  assert(run, 'docs-input-artifact-run');
  for (const [key, value] of Object.entries({ id: run.id,
    repository_id: selected.repositoryId, head_repository_id: selected.repositoryId,
    head_sha: selected.source.head, head_branch: run.head_branch })) {
    assert.deepEqual(artifact.workflow_run?.[key], value, `docs-input-artifact-run-${key}`);
  }
}
