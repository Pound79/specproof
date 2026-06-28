import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveRepoRoot, resolveDefaultManifestPath, normalizeMsysPath } from '../paths.js';

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

describe('normalizeMsysPath', () => {
  describe('on win32', () => {
    beforeEach(() => {
      vi.stubGlobal('process', { ...process, platform: 'win32' });
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('converts MSYS /c/Users/... to C:/Users/...', () => {
      expect(normalizeMsysPath('/c/Users/foo/repo')).toBe('C:/Users/foo/repo');
    });

    it('converts uppercase drive letter', () => {
      expect(normalizeMsysPath('/D/projects/app')).toBe('D:/projects/app');
    });

    it('handles bare drive root /c', () => {
      expect(normalizeMsysPath('/c')).toBe('C:/');
    });

    it('passes through multi-char first segment paths unchanged', () => {
      expect(normalizeMsysPath('/home/user/repo')).toBe('/home/user/repo');
    });

    it('passes through Windows-native paths unchanged', () => {
      expect(normalizeMsysPath('C:\\Users\\foo')).toBe('C:\\Users\\foo');
    });

    it('passes through relative paths unchanged', () => {
      expect(normalizeMsysPath('src/main')).toBe('src/main');
    });
  });

  describe('on non-Windows', () => {
    it('does not convert single-char root paths on macOS/Linux', () => {
      expect(normalizeMsysPath('/c/Users/foo')).toBe('/c/Users/foo');
    });
  });
});

describe('resolveDefaultManifestPath', () => {
  it('returns traceability.yaml under the given root', () => {
    const result = resolveDefaultManifestPath('/some/repo');

    expect(result).toBe(path.join('/some/repo', 'traceability.yaml'));
  });
});
