import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveWithinRoot } from '../resolve.js';

const ROOT = '/repo/root';

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
});
