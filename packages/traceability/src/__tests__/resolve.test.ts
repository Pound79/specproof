import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveWithinRoot } from '../resolve.js';

const TEMP = mkdtempSync(path.join(tmpdir(), 'traceability-resolve-root-'));
const ROOT = path.join(TEMP, 'root');
mkdirSync(ROOT);

afterAll(() => rmSync(TEMP, { recursive: true, force: true }));

describe('resolveWithinRoot', () => {
  it('resolves a relative path inside the repo root', () => {
    expect(resolveWithinRoot(ROOT, 'packages/e2e/a.feature')).toBe(
      path.join(ROOT, 'packages/e2e/a.feature')
    );
  });

  it('allows the repo root itself', () => {
    expect(resolveWithinRoot(ROOT, '.')).toBe(ROOT);
  });

  it('rejects a path that escapes the repo root with ..', () => {
    expect(() => resolveWithinRoot(ROOT, '../secrets.txt')).toThrow(
      /outside the repository root/
    );
  });

  it('rejects an absolute path outside the repo root', () => {
    expect(() => resolveWithinRoot(ROOT, '/etc/passwd')).toThrow(
      /outside the repository root/
    );
  });

  it('does not treat a sibling directory with a shared prefix as inside', () => {
    expect(() => resolveWithinRoot(ROOT, '../root-evil/x')).toThrow(
      /outside the repository root/
    );
  });

  it('allows a missing path beneath a real repository root', () => {
    expect(resolveWithinRoot(ROOT, 'missing/file.ts')).toBe(
      path.join(ROOT, 'missing/file.ts')
    );
  });

  it('allows an in-repository path whose name starts with two dots', () => {
    expect(resolveWithinRoot(ROOT, '..generated/file.ts')).toBe(
      path.join(ROOT, '..generated/file.ts')
    );
  });

  it('allows a symlink whose physical target stays inside the repository', () => {
    const realDir = path.join(ROOT, 'real-dir');
    mkdirSync(realDir);
    writeFileSync(path.join(realDir, 'file.ts'), 'export {};\n');
    symlinkSync(realDir, path.join(ROOT, 'internal-link'));

    expect(resolveWithinRoot(ROOT, 'internal-link/file.ts')).toBe(
      path.join(ROOT, 'internal-link/file.ts')
    );
  });

  it('rejects an existing file that escapes through a repository symlink', () => {
    const temp = mkdtempSync(path.join(tmpdir(), 'traceability-resolve-'));
    const repo = path.join(temp, 'repo');
    const outside = path.join(temp, 'outside');
    mkdirSync(path.join(repo, 'docs'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'secret.md'), '# secret\n');
    symlinkSync(outside, path.join(repo, 'docs', 'external'));

    try {
      expect(() =>
        resolveWithinRoot(repo, 'docs/external/secret.md')
      ).toThrow(/outside the repository root/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('rejects a missing leaf beneath a symlink that escapes the repository', () => {
    const temp = mkdtempSync(path.join(tmpdir(), 'traceability-resolve-missing-'));
    const repo = path.join(temp, 'repo');
    const outside = path.join(temp, 'outside');
    mkdirSync(repo);
    mkdirSync(outside);
    symlinkSync(outside, path.join(repo, 'external'));

    try {
      expect(() => resolveWithinRoot(repo, 'external/missing.ts')).toThrow(
        /outside the repository root/
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('rejects a dangling symbolic link', () => {
    symlinkSync(path.join(ROOT, 'does-not-exist'), path.join(ROOT, 'dangling'));

    expect(() => resolveWithinRoot(ROOT, 'dangling/file.ts')).toThrow(
      /unresolved symbolic link/
    );
  });

  it('preserves missing semantics when an intermediate component is a file', () => {
    writeFileSync(path.join(ROOT, 'regular-file'), 'content\n');

    expect(resolveWithinRoot(ROOT, 'regular-file/child.ts')).toBe(
      path.join(ROOT, 'regular-file/child.ts')
    );
  });

  it('rejects a repository root that does not exist', () => {
    expect(() =>
      resolveWithinRoot(path.join(TEMP, 'missing-root'), 'file.ts')
    ).toThrow(/repository root.*does not exist/i);
  });
});
