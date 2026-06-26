import { describe, expect, it } from 'vitest';
import type { DriftEntry, DriftReport, DriftWarning } from '../check.js';
import {
  describeEntry,
  describeWarning,
  isCheckFailure,
  toGithubAnnotation,
  toGithubWarningAnnotation,
} from '../cli-check-format.js';

const baseEntry: DriftEntry = {
  linkId: 'login',
  side: 'impl',
  path: 'src/login.ts',
  storedHash: 'aaa',
  currentHash: 'bbb',
  status: 'changed',
};

const emptyLinkWarning: DriftWarning = {
  linkId: 'orphan',
  kind: 'empty-link',
  message:
    'link "orphan" tracks nothing (spec, impl and features are all empty)',
};

const cleanReport: DriftReport = {
  clean: true,
  driftCount: 0,
  driftLinkCount: 0,
  entries: [],
  warnings: [],
};

describe('describeEntry', () => {
  it('formats an impl entry without heading', () => {
    const result = describeEntry(baseEntry);

    expect(result).toBe('[impl] src/login.ts — changed');
  });

  it('formats a spec entry with heading', () => {
    const entry: DriftEntry = {
      ...baseEntry,
      side: 'spec',
      path: 'docs/spec.md',
      heading: '1. Login',
    };

    const result = describeEntry(entry);

    expect(result).toBe('[spec] docs/spec.md § 1. Login — changed');
  });

  it('shows missing status', () => {
    const entry: DriftEntry = { ...baseEntry, status: 'missing' };

    const result = describeEntry(entry);

    expect(result).toBe('[impl] src/login.ts — missing');
  });

  it('shows feature side', () => {
    const entry: DriftEntry = {
      ...baseEntry,
      side: 'feature',
      path: 'features/login.feature',
    };

    const result = describeEntry(entry);

    expect(result).toBe('[feature] features/login.feature — changed');
  });
});

describe('toGithubAnnotation', () => {
  it('produces a ::warning annotation for a file entry', () => {
    const result = toGithubAnnotation(baseEntry);

    expect(result).toBe(
      '::warning file=src/login.ts::Traceability drift in link "login" (impl, changed). Sync the linked feature (bdd-sync) or run: bdd-traceability-update',
    );
  });

  it('includes heading info for spec entries', () => {
    const entry: DriftEntry = {
      ...baseEntry,
      side: 'spec',
      path: 'docs/spec.md',
      heading: '1. Login',
    };

    const result = toGithubAnnotation(entry);

    expect(result).toContain('at heading "1. Login"');
    expect(result.startsWith('::warning file=docs/spec.md::')).toBe(true);
  });

  it('omits heading segment for non-spec entries', () => {
    const result = toGithubAnnotation(baseEntry);

    expect(result).not.toContain('at heading');
  });
});

describe('describeWarning', () => {
  it('formats an empty-link warning', () => {
    expect(describeWarning(emptyLinkWarning)).toBe(
      '[warning] link "orphan" tracks nothing (spec, impl and features are all empty)'
    );
  });
});

describe('toGithubWarningAnnotation', () => {
  it('produces a ::warning:: workflow annotation', () => {
    expect(toGithubWarningAnnotation(emptyLinkWarning)).toBe(
      '::warning::bdd-kit traceability: link "orphan" tracks nothing (spec, impl and features are all empty)'
    );
  });
});

describe('isCheckFailure', () => {
  it('passes a clean report regardless of strict', () => {
    expect(isCheckFailure(cleanReport, false)).toBe(false);
    expect(isCheckFailure(cleanReport, true)).toBe(false);
  });

  it('fails whenever drift is present, with or without strict', () => {
    const drifted: DriftReport = {
      ...cleanReport,
      clean: false,
      driftCount: 1,
      driftLinkCount: 1,
      entries: [baseEntry],
    };

    expect(isCheckFailure(drifted, false)).toBe(true);
    expect(isCheckFailure(drifted, true)).toBe(true);
  });

  it('fails when both drift and warnings are present', () => {
    const both: DriftReport = {
      ...cleanReport,
      clean: false,
      driftCount: 1,
      driftLinkCount: 1,
      entries: [baseEntry],
      warnings: [emptyLinkWarning],
    };

    expect(isCheckFailure(both, false)).toBe(true);
    expect(isCheckFailure(both, true)).toBe(true);
  });

  it('fails on structural warnings only under strict', () => {
    const warned: DriftReport = { ...cleanReport, warnings: [emptyLinkWarning] };

    expect(isCheckFailure(warned, false)).toBe(false);
    expect(isCheckFailure(warned, true)).toBe(true);
  });
});
