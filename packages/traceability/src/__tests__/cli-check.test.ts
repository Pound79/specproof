import { describe, expect, it } from 'vitest';
import type { DriftEntry, DriftReport, DriftWarning } from '../check.js';
import {
  attachFailsUnderStrict,
  describeEntry,
  describeWarning,
  isCheckFailure,
  selectWarningsForDisplay,
  toGithubAnnotation,
  toGithubWarningAnnotation,
  warningFailsUnderStrict,
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
  bothSidesChanged: [],
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
      '::warning file=src/login.ts::Traceability drift in link "login" (impl, changed). Sync the linked feature (specproof-sync) or run: specproof-update',
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
  it('formats a hard warning with the [warning] label', () => {
    expect(describeWarning(emptyLinkWarning, true)).toBe(
      '[warning] link "orphan" tracks nothing (spec, impl and features are all empty)'
    );
  });

  it('formats an advisory warning with the [advisory] label', () => {
    const warning: DriftWarning = {
      kind: 'unregistered-impl',
      path: 'src/orphan.ts',
      message: 'unregistered-impl warning',
    };

    expect(describeWarning(warning, false)).toBe(
      '[advisory] unregistered-impl warning',
    );
  });
});

describe('toGithubWarningAnnotation', () => {
  it('produces a ::warning:: workflow annotation', () => {
    expect(toGithubWarningAnnotation(emptyLinkWarning)).toBe(
      '::warning::specproof traceability: link "orphan" tracks nothing (spec, impl and features are all empty)'
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

  it.each<DriftWarning['kind']>([
    'unregistered-feature',
    'duplicate-heading',
  ])(
    'escalates a %s warning under --strict, like empty-link',
    (kind) => {
      const warning: DriftWarning = {
        kind,
        path: 'docs/spec.md',
        message: `${kind} warning`,
      };
      const warned: DriftReport = { ...cleanReport, warnings: [warning] };

      expect(isCheckFailure(warned, false)).toBe(false);
      expect(isCheckFailure(warned, true)).toBe(true);
    },
  );

  it('does not escalate unregistered-impl under --strict by default', () => {
    const warning: DriftWarning = {
      kind: 'unregistered-impl',
      path: 'src/orphan.ts',
      message: 'unregistered-impl warning',
    };
    const warned: DriftReport = { ...cleanReport, warnings: [warning] };

    expect(isCheckFailure(warned, false)).toBe(false);
    expect(isCheckFailure(warned, true)).toBe(false);
  });

  it('escalates unregistered-impl under --strict only when strictUnregisteredImpl opts in', () => {
    const warning: DriftWarning = {
      kind: 'unregistered-impl',
      path: 'src/orphan.ts',
      message: 'unregistered-impl warning',
    };
    const warned: DriftReport = { ...cleanReport, warnings: [warning] };

    expect(isCheckFailure(warned, true, { strictUnregisteredImpl: true })).toBe(
      true,
    );
    expect(
      isCheckFailure(warned, false, { strictUnregisteredImpl: true }),
    ).toBe(false);
  });

  it('does not escalate unregistered-spec-heading under --strict by default', () => {
    const warning: DriftWarning = {
      kind: 'unregistered-spec-heading',
      path: 'docs/spec.md',
      message: 'unregistered-spec-heading warning',
    };
    const warned: DriftReport = { ...cleanReport, warnings: [warning] };

    expect(isCheckFailure(warned, false)).toBe(false);
    expect(isCheckFailure(warned, true)).toBe(false);
  });

  it('escalates unregistered-spec-heading under --strict only when strictUnregisteredSpecHeadings opts in', () => {
    const warning: DriftWarning = {
      kind: 'unregistered-spec-heading',
      path: 'docs/spec.md',
      message: 'unregistered-spec-heading warning',
    };
    const warned: DriftReport = { ...cleanReport, warnings: [warning] };

    expect(
      isCheckFailure(warned, true, { strictUnregisteredSpecHeadings: true }),
    ).toBe(true);
    expect(
      isCheckFailure(warned, false, { strictUnregisteredSpecHeadings: true }),
    ).toBe(false);
  });
});

describe('warningFailsUnderStrict', () => {
  it.each<DriftWarning['kind']>([
    'empty-link',
    'unreviewed-draft',
    'missing-skip-reason',
    'unregistered-feature',
    'duplicate-heading',
  ])('always escalates %s, with or without options', (kind) => {
    expect(warningFailsUnderStrict(kind)).toBe(true);
    expect(
      warningFailsUnderStrict(kind, {
        strictUnregisteredImpl: false,
        strictUnregisteredSpecHeadings: false,
      }),
    ).toBe(true);
  });

  it('escalates unregistered-impl only when strictUnregisteredImpl opts in', () => {
    expect(warningFailsUnderStrict('unregistered-impl')).toBe(false);
    expect(
      warningFailsUnderStrict('unregistered-impl', {
        strictUnregisteredImpl: false,
      }),
    ).toBe(false);
    expect(
      warningFailsUnderStrict('unregistered-impl', {
        strictUnregisteredImpl: true,
      }),
    ).toBe(true);
  });

  it('escalates unregistered-spec-heading only when strictUnregisteredSpecHeadings opts in', () => {
    expect(warningFailsUnderStrict('unregistered-spec-heading')).toBe(false);
    expect(
      warningFailsUnderStrict('unregistered-spec-heading', {
        strictUnregisteredSpecHeadings: false,
      }),
    ).toBe(false);
    expect(
      warningFailsUnderStrict('unregistered-spec-heading', {
        strictUnregisteredSpecHeadings: true,
      }),
    ).toBe(true);
  });
});

describe('attachFailsUnderStrict', () => {
  const implWarning: DriftWarning = {
    kind: 'unregistered-impl',
    path: 'src/orphan.ts',
    message: 'unregistered-impl warning',
  };
  const specHeadingWarning: DriftWarning = {
    kind: 'unregistered-spec-heading',
    path: 'docs/spec.md',
    message: 'unregistered-spec-heading warning',
  };

  it('annotates each warning with its effective failsUnderStrict verdict (opt-ins off)', () => {
    const result = attachFailsUnderStrict([
      emptyLinkWarning,
      implWarning,
      specHeadingWarning,
    ]);

    expect(result).toEqual([
      { ...emptyLinkWarning, failsUnderStrict: true },
      { ...implWarning, failsUnderStrict: false },
      { ...specHeadingWarning, failsUnderStrict: false },
    ]);
  });

  it('flips opt-in warnings to failsUnderStrict: true when the matching flag is set', () => {
    const result = attachFailsUnderStrict([implWarning, specHeadingWarning], {
      strictUnregisteredImpl: true,
      strictUnregisteredSpecHeadings: true,
    });

    expect(result.every((warning) => warning.failsUnderStrict)).toBe(true);
  });

  it('does not mutate the input warnings', () => {
    attachFailsUnderStrict([emptyLinkWarning]);

    expect(emptyLinkWarning).not.toHaveProperty('failsUnderStrict');
  });
});

describe('selectWarningsForDisplay', () => {
  const implWarning = (index: number): DriftWarning => ({
    kind: 'unregistered-impl',
    path: `src/orphan-${index}.ts`,
    message: `unregistered impl ${index}`,
  });

  it('shows every warning unchanged at or under the truncation limit', () => {
    const warnings = Array.from({ length: 20 }, (_, index) =>
      implWarning(index),
    );

    const result = selectWarningsForDisplay(warnings);

    expect(result.shown).toEqual(warnings);
    expect(result.hiddenCount).toBe(0);
  });

  it('truncates unregistered-impl warnings past the limit and reports the hidden count', () => {
    const warnings = Array.from({ length: 21 }, (_, index) =>
      implWarning(index),
    );

    const result = selectWarningsForDisplay(warnings);

    expect(result.shown).toHaveLength(20);
    expect(result.shown).toEqual(warnings.slice(0, 20));
    expect(result.hiddenCount).toBe(1);
  });

  it('never truncates or counts non-unregistered-impl warnings toward the limit', () => {
    const implWarnings = Array.from({ length: 25 }, (_, index) =>
      implWarning(index),
    );
    const warnings = [...implWarnings, emptyLinkWarning];

    const result = selectWarningsForDisplay(warnings);

    expect(result.shown).toContainEqual(emptyLinkWarning);
    expect(result.shown).toHaveLength(21);
    expect(result.hiddenCount).toBe(5);
  });
});
