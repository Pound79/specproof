import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditUnregisteredImpl, findImplCandidates } from '../impl-audit.js';
import type { TraceabilityManifest } from '../manifest.js';

const touch = async (root: string, relPath: string): Promise<void> => {
  const absPath = path.join(root, relPath);
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, '// stub\n', 'utf8');
};

const buildManifest = (implPaths: string[]): TraceabilityManifest => ({
  version: 1,
  links: [
    {
      id: 'login',
      label: 'Login',
      spec: [],
      impl: implPaths.map((implPath) => ({ path: implPath, hash: 'x' })),
      features: [],
    },
  ],
});

describe('findImplCandidates', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'traceability-impl-audit-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('matches files under a globstar prefix pattern, rooted at the literal prefix', async () => {
    await touch(root, 'src/a.ts');
    await touch(root, 'src/nested/b.ts');
    await touch(root, 'other/c.ts');

    const candidates = await findImplCandidates(root, ['src/**/*.ts']);

    expect(candidates).toEqual(['src/a.ts', 'src/nested/b.ts']);
  });

  it('never descends into node_modules, .git, dist, or build even when the pattern would match them', async () => {
    await touch(root, 'src/a.ts');
    await touch(root, 'node_modules/pkg/index.ts');
    await touch(root, 'dist/output.ts');
    await touch(root, 'build/output.ts');
    await touch(root, '.git/HEAD.ts');

    const candidates = await findImplCandidates(root, ['**/*.ts']);

    expect(candidates).toEqual(['src/a.ts']);
  });

  it('deduplicates a file matched by more than one glob', async () => {
    await touch(root, 'src/a.ts');

    const candidates = await findImplCandidates(root, [
      'src/**/*.ts',
      '**/*.ts',
    ]);

    expect(candidates).toEqual(['src/a.ts']);
  });
});

describe('auditUnregisteredImpl', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'traceability-impl-audit-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns no warnings when implGlobs is undefined', async () => {
    await touch(root, 'src/a.ts');
    const manifest = buildManifest([]);

    expect(await auditUnregisteredImpl(manifest, root, undefined)).toEqual([]);
  });

  it('returns no warnings when implGlobs is an empty array', async () => {
    await touch(root, 'src/a.ts');
    const manifest = buildManifest([]);

    expect(await auditUnregisteredImpl(manifest, root, [])).toEqual([]);
  });

  it('flags a matched file that no link registers, and not a registered one', async () => {
    await touch(root, 'src/a.ts');
    await touch(root, 'src/b.ts');
    const manifest = buildManifest(['src/a.ts']);

    const warnings = await auditUnregisteredImpl(manifest, root, [
      'src/**/*.ts',
    ]);

    expect(warnings).toEqual([
      expect.objectContaining({
        kind: 'unregistered-impl',
        path: 'src/b.ts',
      }),
    ]);
  });

  it('returns no warnings when every matched file is registered', async () => {
    await touch(root, 'src/a.ts');
    const manifest = buildManifest(['src/a.ts']);

    const warnings = await auditUnregisteredImpl(manifest, root, [
      'src/**/*.ts',
    ]);

    expect(warnings).toEqual([]);
  });
});
