import { describe, expect, it } from 'vitest';
import { parseFlags } from '../flags.js';

describe('parseFlags', () => {
  it('parses a flag with a string value', () => {
    const result = parseFlags(['--adapter', 'playwright']);

    expect(result).toEqual({ adapter: 'playwright' });
  });

  it('parses a boolean flag', () => {
    const result = parseFlags(['--force']);

    expect(result).toEqual({ force: true });
  });

  it('treats a flag followed by another flag as boolean', () => {
    const result = parseFlags(['--force', '--json']);

    expect(result).toEqual({ force: true, json: true });
  });

  it('parses mixed flags', () => {
    const result = parseFlags(['--adapter', 'flutter', '--force', '--dir', 'e2e']);

    expect(result).toEqual({ adapter: 'flutter', force: true, dir: 'e2e' });
  });

  it('returns an empty object for an empty array', () => {
    const result = parseFlags([]);

    expect(result).toEqual({});
  });

  it('ignores positional arguments without --', () => {
    const result = parseFlags(['init', '--adapter', 'playwright']);

    expect(result).toEqual({ adapter: 'playwright' });
  });

  it('handles the last flag as boolean when no value follows', () => {
    const result = parseFlags(['--adapter', 'playwright', '--json']);

    expect(result).toEqual({ adapter: 'playwright', json: true });
  });
});
