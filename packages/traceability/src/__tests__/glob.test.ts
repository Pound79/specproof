import { describe, expect, it } from 'vitest';
import { globBaseDir, globToRegExp } from '../glob.js';

describe('globToRegExp', () => {
  it('matches a mid-pattern globstar with zero or more intermediate segments', () => {
    const re = globToRegExp('src/**/*.ts');
    expect(re.test('src/foo.ts')).toBe(true);
    expect(re.test('src/a/foo.ts')).toBe(true);
    expect(re.test('src/a/b/foo.ts')).toBe(true);
    expect(re.test('src/foo.tsx')).toBe(false);
    expect(re.test('other/foo.ts')).toBe(false);
  });

  it('matches a leading globstar at any depth including the top level', () => {
    const re = globToRegExp('**/*.feature');
    expect(re.test('foo.feature')).toBe(true);
    expect(re.test('a/foo.feature')).toBe(true);
    expect(re.test('a/b/foo.feature')).toBe(true);
    expect(re.test('foo.txt')).toBe(false);
  });

  it('matches a trailing globstar covering everything under the prefix', () => {
    const re = globToRegExp('foo/**');
    expect(re.test('foo/a.ts')).toBe(true);
    expect(re.test('foo/a/b.ts')).toBe(true);
    expect(re.test('foo')).toBe(false);
    expect(re.test('bar/a.ts')).toBe(false);
  });

  it('supports a single "*" as a one-segment wildcard', () => {
    const re = globToRegExp('src/*.ts');
    expect(re.test('src/foo.ts')).toBe(true);
    expect(re.test('src/a/foo.ts')).toBe(false);
  });

  it('escapes regex-special characters in literal segments', () => {
    const re = globToRegExp('src/a.b+c/*.ts');
    expect(re.test('src/a.b+c/foo.ts')).toBe(true);
    expect(re.test('src/aXbXc/foo.ts')).toBe(false);
  });
});

describe('globBaseDir', () => {
  it('returns the literal prefix before the first wildcard segment', () => {
    expect(globBaseDir('src/**/*.ts')).toBe('src');
    expect(globBaseDir('foo/**')).toBe('foo');
    expect(globBaseDir('foo/bar/*.ts')).toBe('foo/bar');
  });

  it('returns "." when the pattern has no literal prefix', () => {
    expect(globBaseDir('**/*.feature')).toBe('.');
    expect(globBaseDir('*.ts')).toBe('.');
  });
});
