import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveRepoRoot, resolveDefaultManifestPath } from '../paths.js';

describe('resolveRepoRoot', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'traceability-paths-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('finds a directory containing bdd-kit.config.yaml', async () => {
    await writeFile(
      path.join(root, 'bdd-kit.config.yaml'),
      'version: 1\n',
      'utf8',
    );

    const result = resolveRepoRoot(root);

    expect(result).toBe(root);
  });

  it('finds a directory containing bdd-kit.config.yml', async () => {
    await writeFile(
      path.join(root, 'bdd-kit.config.yml'),
      'version: 1\n',
      'utf8',
    );

    const result = resolveRepoRoot(root);

    expect(result).toBe(root);
  });

  it('finds a directory containing traceability.yaml', async () => {
    await writeFile(
      path.join(root, 'traceability.yaml'),
      'version: 1\n',
      'utf8',
    );

    const result = resolveRepoRoot(root);

    expect(result).toBe(root);
  });

  it('walks up to a parent directory containing a marker', async () => {
    await writeFile(
      path.join(root, 'bdd-kit.config.yaml'),
      'version: 1\n',
      'utf8',
    );
    const child = path.join(root, 'packages', 'sub');
    await mkdir(child, { recursive: true });

    const result = resolveRepoRoot(child);

    expect(result).toBe(root);
  });

  it('prefers bdd-kit.config.yaml over traceability.yaml in the same dir', async () => {
    await writeFile(
      path.join(root, 'bdd-kit.config.yaml'),
      'version: 1\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'traceability.yaml'),
      'version: 1\n',
      'utf8',
    );

    const result = resolveRepoRoot(root);

    expect(result).toBe(root);
  });

  it('throws when no marker file and not inside a git repo', async () => {
    expect(() => resolveRepoRoot(root)).toThrow(
      /Could not resolve a repo root/,
    );
  });
});

describe('resolveDefaultManifestPath', () => {
  it('returns traceability.yaml under the given root', () => {
    const result = resolveDefaultManifestPath('/some/repo');

    expect(result).toBe(path.join('/some/repo', 'traceability.yaml'));
  });
});
