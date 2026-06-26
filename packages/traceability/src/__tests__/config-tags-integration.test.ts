import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverConfig } from '../config.js';
import { checkDrift } from '../check.js';
import { buildStats, type FeatureScenarios } from '../stats.js';
import { parseScenarios } from '../feature-scan.js';
import { readFileOrNull } from '../hash.js';
import { resolveWithinRoot } from '../resolve.js';

// Integration of the config → engine seam that the CLIs wire together
// (cli-check.ts: reasonRequiredTags: [config.fixmeTag, config.skipTag];
//  cli-stats.ts: buildStats(features, { fixmeTag, skipTag })). discoverConfig
// reading the tags and the engine honouring them are each unit-tested; these
// tests guard the COMPOSITION so a silently reverted wiring line is caught.

const created: string[] = [];

const makeRenamedTaxonomyRepo = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'bddtrace-int-'));
  created.push(root);
  await mkdir(path.join(root, 'features'), { recursive: true });
  await writeFile(
    path.join(root, 'bdd-kit.config.yaml'),
    [
      'tags:',
      "  fixme: '@todo'",
      "  skip: '@manual'",
      'layout:',
      '  manifest: traceability.yaml',
      '  featuresDir: features',
      '',
    ].join('\n'),
  );
  await writeFile(path.join(root, 'traceability.yaml'), 'version: 1\nlinks: []\n');
  await writeFile(
    path.join(root, 'features/demo.feature'),
    [
      '# language: ja',
      '機能: デモ',
      '',
      '@todo',
      'シナリオ: 後で自動化する',
      '  前提 何かがある',
      '',
      '@manual',
      'シナリオ: 理由なし手動',
      '  前提 何かがある',
      '',
    ].join('\n'),
  );
  return root;
};

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('config → checkDrift wiring (cli-check path)', () => {
  it('flags a reason-less @todo via the config-supplied reasonRequiredTags', async () => {
    const root = await makeRenamedTaxonomyRepo();
    const config = discoverConfig({ root });

    // Exactly what cli-check.ts does.
    const report = await checkDrift(config.manifestPath, config.repoRoot, {
      featuresDir: config.featuresDir,
      reasonRequiredTags: [config.fixmeTag, config.skipTag],
    });

    const reasonWarnings = report.warnings.filter(
      (w) => w.kind === 'missing-skip-reason',
    );
    expect(reasonWarnings.map((w) => w.path)).toEqual([
      'features/demo.feature',
      'features/demo.feature',
    ]);
    // The custom fixme tag wins naming when first in priority order.
    expect(reasonWarnings[0]?.message).toContain('@todo');
  });
});

describe('config → buildStats wiring (cli-stats path)', () => {
  it('counts the custom @todo as fixme so the done gate is not falsely green', async () => {
    const root = await makeRenamedTaxonomyRepo();
    const config = discoverConfig({ root });

    const content = await readFileOrNull(
      resolveWithinRoot(config.repoRoot, 'features/demo.feature'),
    );
    const features: FeatureScenarios[] = [
      { domain: 'features/demo.feature', scenarios: parseScenarios(content ?? '') },
    ];

    // Exactly what cli-stats.ts does.
    const report = buildStats(features, {
      fixmeTag: config.fixmeTag,
      skipTag: config.skipTag,
    });

    expect(report.totals).toMatchObject({
      total: 2,
      automated: 0,
      fixme: 1, // @todo
      skip: 1, // @manual
    });
    expect(report.fixmeClean).toBe(false); // outstanding @todo blocks done
  });
});
