import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const created = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map(root => rename(root, `${root}-done`)));
});

const runStats = async (feature, flags) => {
  const root = await mkdtemp(path.join(tmpdir(), 'specproof-s1-'));
  created.push(root);
  await mkdir(path.join(root, 'features'));
  await writeFile(path.join(root, 'specproof.config.yaml'),
    'layout:\n  featuresDir: features\n  manifest: traceability.yaml\n');
  await writeFile(path.join(root, 'traceability.yaml'), 'version: 1\nlinks: []\n');
  await writeFile(path.join(root, 'features/demo.feature'), feature);
  const result = spawnSync(process.execPath, [
    '--import', 'tsx',
    fileURLToPath(new URL('../packages/traceability/src/cli-stats.ts', import.meta.url)),
    '--root', root, ...flags,
  ], { encoding: 'utf8' });
  assert.ifError(result.error);
  return result;
};

test('S1: JSON と表示が一致し、残った red-contract は strict で失敗する', async () => {
  const feature = 'Feature: 条件\n@red-contract @human\nScenario: 未実装\n Given 条件\n';
  const json = await runStats(feature, ['--json']);
  assert.equal(json.status, 0, json.stderr);
  const report = JSON.parse(json.stdout);
  assert.equal(report.totals.total, 1);
  assert.equal(report.totals.cases, 1);
  assert.equal(report.done, false);
  assert.equal(report.totals.fixme, undefined);
  assert.deepEqual(report.totals.phase, { draft: 0, pending: 1, complete: 0 });
  assert.deepEqual(report.totals.verification, { machine: 0, human: 1 });
  const text = await runStats(feature, []);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /TOTAL: 1 conditions \/ 1 cases; phase: draft 0 \/ pending 1 \/ complete 0; verification: machine 0 \/ human 1; out-of-scope 0/);
  const strict = await runStats(feature, ['--strict']);
  assert.equal(strict.status, 1, strict.stderr);
  assert.match(strict.stdout, /@red-contract remaining: 1/);
});

test('S1: 実装待ちも実行を止めるタグも無ければ strict に成功する', async () => {
  const run = await runStats('Feature: 条件\nScenario: 完了\n Given 条件\n Then 結果\n', ['--strict']);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /@red-contract is 0/);
});

test('S1: 実行を止める fixme / skip / fail が付いていれば strict で失敗する', async () => {
  for (const tag of ['@fixme', '@skip', '@fail']) {
    const run = await runStats(`Feature: 条件\n${tag}\nScenario: 残件\n Given 条件\n`, ['--strict']);
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stdout, /tags that switch scenarios off \(@fixme \/ @skip \/ @fail\) remaining: 1/);
  }
});

test('S1: 不正な状態併記は JSON 成功や候補0件にしない', async () => {
  const run = await runStats('Feature: 条件\n@draft @red-contract\nScenario: 併記\n', ['--json']);
  assert.equal(run.status, 2);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /@draft/);
});


test('S1: 閉じていないdocstringは静的doneの成功にしない', async () => {
  const run = await runStats('Feature: 条件\nScenario: 本文\n Given 説明\n  """\n @fixme\n Scenario: 隠された残件\n', ['--strict', '--json']);
  assert.equal(run.status, 2);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /docstring/);
});
