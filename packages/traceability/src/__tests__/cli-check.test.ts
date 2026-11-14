import { describe, expect, it } from "vitest";
import type { DriftEntry, DriftReport, DriftWarning } from "../check.js";
import {
  attachFailsUnderStrict,
  describeEntry,
  describeHiddenWarnings,
  describeWarning,
  isCheckFailure,
  selectWarningsForDisplay,
  toGithubAnnotation,
  toGithubWarningAnnotation,
  warningFailsUnderStrict,
} from "../cli-check-format.js";

const baseEntry: DriftEntry = {
  linkId: "login",
  side: "impl",
  path: "src/login.ts",
  storedHash: "aaa",
  currentHash: "bbb",
  status: "changed",
};

const emptyLinkWarning: DriftWarning = {
  linkId: "orphan",
  kind: "empty-link",
  message: 'link "orphan" tracks nothing (spec, impl and features are all empty)',
};

const cleanReport: DriftReport = {
  clean: true,
  driftCount: 0,
  driftLinkCount: 0,
  entries: [],
  warnings: [],
  bothSidesChanged: [],
  allReferencesMissing: false,
};

describe("describeEntry", () => {
  it("formats an impl entry without heading", () => {
    const result = describeEntry(baseEntry);

    expect(result).toBe("[impl] src/login.ts — changed");
  });

  it("formats a spec entry with heading", () => {
    const entry: DriftEntry = {
      ...baseEntry,
      side: "spec",
      path: "docs/spec.md",
      heading: "1. Login",
    };

    const result = describeEntry(entry);

    expect(result).toBe("[spec] docs/spec.md § 1. Login — changed");
  });

  it("shows missing status", () => {
    const entry: DriftEntry = { ...baseEntry, status: "missing" };

    const result = describeEntry(entry);

    expect(result).toBe("[impl] src/login.ts — missing");
  });

  it("shows feature side", () => {
    const entry: DriftEntry = {
      ...baseEntry,
      side: "feature",
      path: "features/login.feature",
    };

    const result = describeEntry(entry);

    expect(result).toBe("[feature] features/login.feature — changed");
  });
});

describe("toGithubAnnotation", () => {
  it("produces a ::warning annotation for a file entry", () => {
    const result = toGithubAnnotation(baseEntry);

    expect(result).toBe(
      '::warning file=src/login.ts::Traceability drift in link "login" (impl, changed). Sync the linked feature (specproof-sync) or bless this link: specproof-update --link-id <link-id> (if the observable behavior changed, decide with the specproof-sync decision table before blessing)',
    );
  });

  it("includes heading info for spec entries", () => {
    const entry: DriftEntry = {
      ...baseEntry,
      side: "spec",
      path: "docs/spec.md",
      heading: "1. Login",
    };

    const result = toGithubAnnotation(entry);

    expect(result).toContain('at heading "1. Login"');
    expect(result.startsWith("::warning file=docs/spec.md::")).toBe(true);
  });

  it("omits heading segment for non-spec entries", () => {
    const result = toGithubAnnotation(baseEntry);

    expect(result).not.toContain("at heading");
  });
});

describe("describeWarning", () => {
  it("formats a hard warning with the [warning] label", () => {
    expect(describeWarning(emptyLinkWarning, true)).toBe(
      '[warning] link "orphan" tracks nothing (spec, impl and features are all empty)',
    );
  });

  it("formats an advisory warning with the [advisory] label", () => {
    const warning: DriftWarning = {
      kind: "unregistered-impl",
      path: "src/orphan.ts",
      message: "unregistered-impl warning",
    };

    expect(describeWarning(warning, false)).toBe("[advisory] unregistered-impl warning");
  });
});

describe("toGithubWarningAnnotation", () => {
  it("produces a ::warning:: workflow annotation", () => {
    expect(toGithubWarningAnnotation(emptyLinkWarning)).toBe(
      '::warning::specproof traceability: link "orphan" tracks nothing (spec, impl and features are all empty)',
    );
  });
});

describe("isCheckFailure", () => {
  it("passes a clean report regardless of strict", () => {
    expect(isCheckFailure(cleanReport, false)).toBe(false);
    expect(isCheckFailure(cleanReport, true)).toBe(false);
  });

  it("fails whenever drift is present, with or without strict", () => {
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

  it("fails when both drift and warnings are present", () => {
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

  it("fails on structural warnings only under strict", () => {
    const warned: DriftReport = { ...cleanReport, warnings: [emptyLinkWarning] };

    expect(isCheckFailure(warned, false)).toBe(false);
    expect(isCheckFailure(warned, true)).toBe(true);
  });

  it.each<DriftWarning["kind"]>(["unregistered-feature", "duplicate-heading"])(
    "escalates a %s warning under --strict, like empty-link",
    (kind) => {
      const warning: DriftWarning = {
        kind,
        path: "docs/spec.md",
        message: `${kind} warning`,
      };
      const warned: DriftReport = { ...cleanReport, warnings: [warning] };

      expect(isCheckFailure(warned, false)).toBe(false);
      expect(isCheckFailure(warned, true)).toBe(true);
    },
  );

  it("does not escalate unregistered-impl under --strict by default", () => {
    const warning: DriftWarning = {
      kind: "unregistered-impl",
      path: "src/orphan.ts",
      message: "unregistered-impl warning",
    };
    const warned: DriftReport = { ...cleanReport, warnings: [warning] };

    expect(isCheckFailure(warned, false)).toBe(false);
    expect(isCheckFailure(warned, true)).toBe(false);
  });

  it("escalates unregistered-impl under --strict only when strictUnregisteredImpl opts in", () => {
    const warning: DriftWarning = {
      kind: "unregistered-impl",
      path: "src/orphan.ts",
      message: "unregistered-impl warning",
    };
    const warned: DriftReport = { ...cleanReport, warnings: [warning] };

    expect(isCheckFailure(warned, true, { strictUnregisteredImpl: true })).toBe(true);
    expect(isCheckFailure(warned, false, { strictUnregisteredImpl: true })).toBe(false);
  });

  it("does not escalate unregistered-spec-heading under --strict by default", () => {
    const warning: DriftWarning = {
      kind: "unregistered-spec-heading",
      path: "docs/spec.md",
      message: "unregistered-spec-heading warning",
    };
    const warned: DriftReport = { ...cleanReport, warnings: [warning] };

    expect(isCheckFailure(warned, false)).toBe(false);
    expect(isCheckFailure(warned, true)).toBe(false);
  });

  it("escalates unregistered-spec-heading under --strict only when strictUnregisteredSpecHeadings opts in", () => {
    const warning: DriftWarning = {
      kind: "unregistered-spec-heading",
      path: "docs/spec.md",
      message: "unregistered-spec-heading warning",
    };
    const warned: DriftReport = { ...cleanReport, warnings: [warning] };

    expect(isCheckFailure(warned, true, { strictUnregisteredSpecHeadings: true })).toBe(true);
    expect(isCheckFailure(warned, false, { strictUnregisteredSpecHeadings: true })).toBe(false);
  });
});

describe("warningFailsUnderStrict", () => {
  it.each<DriftWarning["kind"]>([
    "empty-link",
    "unreviewed-draft",
    "missing-reason",
    "disallowed-tag",
    "unregistered-feature",
    "duplicate-heading",
    "features-dir-unset",
    "features-dir-missing",
  ])("always escalates %s, with or without options", (kind) => {
    expect(warningFailsUnderStrict(kind)).toBe(true);
    expect(
      warningFailsUnderStrict(kind, {
        strictUnregisteredImpl: false,
        strictUnregisteredSpecHeadings: false,
      }),
    ).toBe(true);
  });

  it("escalates unregistered-impl only when strictUnregisteredImpl opts in", () => {
    expect(warningFailsUnderStrict("unregistered-impl")).toBe(false);
    expect(
      warningFailsUnderStrict("unregistered-impl", {
        strictUnregisteredImpl: false,
      }),
    ).toBe(false);
    expect(
      warningFailsUnderStrict("unregistered-impl", {
        strictUnregisteredImpl: true,
      }),
    ).toBe(true);
  });

  it("escalates unregistered-spec-heading only when strictUnregisteredSpecHeadings opts in", () => {
    expect(warningFailsUnderStrict("unregistered-spec-heading")).toBe(false);
    expect(
      warningFailsUnderStrict("unregistered-spec-heading", {
        strictUnregisteredSpecHeadings: false,
      }),
    ).toBe(false);
    expect(
      warningFailsUnderStrict("unregistered-spec-heading", {
        strictUnregisteredSpecHeadings: true,
      }),
    ).toBe(true);
  });
});

describe("attachFailsUnderStrict", () => {
  const implWarning: DriftWarning = {
    kind: "unregistered-impl",
    path: "src/orphan.ts",
    message: "unregistered-impl warning",
  };
  const specHeadingWarning: DriftWarning = {
    kind: "unregistered-spec-heading",
    path: "docs/spec.md",
    message: "unregistered-spec-heading warning",
  };

  it("annotates each warning with its effective failsUnderStrict verdict (opt-ins off)", () => {
    const result = attachFailsUnderStrict([emptyLinkWarning, implWarning, specHeadingWarning]);

    expect(result).toEqual([
      { ...emptyLinkWarning, failsUnderStrict: true },
      { ...implWarning, failsUnderStrict: false },
      { ...specHeadingWarning, failsUnderStrict: false },
    ]);
  });

  it("flips opt-in warnings to failsUnderStrict: true when the matching flag is set", () => {
    const result = attachFailsUnderStrict([implWarning, specHeadingWarning], {
      strictUnregisteredImpl: true,
      strictUnregisteredSpecHeadings: true,
    });

    expect(result.every((warning) => warning.failsUnderStrict)).toBe(true);
  });

  it("does not mutate the input warnings", () => {
    attachFailsUnderStrict([emptyLinkWarning]);

    expect(emptyLinkWarning).not.toHaveProperty("failsUnderStrict");
  });
});

describe("selectWarningsForDisplay の矛盾の候補", () => {
  it("possible-contradiction は上限を超えた分を隠し、ほかの warning は全部出す", () => {
    const contradictions = Array.from({ length: 30 }, (_, i) => ({
      kind: "possible-contradiction" as const,
      path: "a.feature",
      message: `c${i}`,
    }));
    const hard = { kind: "missing-then" as const, path: "a.feature", message: "m" };
    const result = selectWarningsForDisplay([...contradictions, hard]);
    expect(result.shown.filter((w) => w.kind === "possible-contradiction")).toHaveLength(10);
    expect(result.shown).toContain(hard);
    expect(result.hiddenCount).toBe(20);
  });
});

describe("selectWarningsForDisplay", () => {
  const implWarning = (index: number): DriftWarning => ({
    kind: "unregistered-impl",
    path: `src/orphan-${index}.ts`,
    message: `unregistered impl ${index}`,
  });

  it("shows every warning unchanged at or under the truncation limit", () => {
    const warnings = Array.from({ length: 20 }, (_, index) => implWarning(index));

    const result = selectWarningsForDisplay(warnings);

    expect(result.shown).toEqual(warnings);
    expect(result.hiddenCount).toBe(0);
  });

  it("truncates unregistered-impl warnings past the limit and reports the hidden count", () => {
    const warnings = Array.from({ length: 21 }, (_, index) => implWarning(index));

    const result = selectWarningsForDisplay(warnings);

    expect(result.shown).toHaveLength(20);
    expect(result.shown).toEqual(warnings.slice(0, 20));
    expect(result.hiddenCount).toBe(1);
  });

  it("never truncates or counts kinds without a display limit toward the limit", () => {
    const implWarnings = Array.from({ length: 25 }, (_, index) => implWarning(index));
    const warnings = [...implWarnings, emptyLinkWarning];

    const result = selectWarningsForDisplay(warnings);

    expect(result.shown).toContainEqual(emptyLinkWarning);
    expect(result.shown).toHaveLength(21);
    expect(result.hiddenCount).toBe(5);
  });
});

describe("selectWarningsForDisplay の種類ごとの省略件数", () => {
  const ofKind = (kind: DriftWarning["kind"], length: number): DriftWarning[] =>
    Array.from({ length }, (_, i) => ({ kind, path: `p${i}`, message: `${kind} ${i}` }));

  it("上限を超えた種類だけを hiddenByKind に数える", () => {
    const warnings = [...ofKind("unregistered-impl", 701), ...ofKind("missing-then", 3)];

    const result = selectWarningsForDisplay(warnings);

    expect(result.hiddenByKind).toEqual({ "unregistered-impl": 681 });
    expect(result.hiddenCount).toBe(681);
  });

  it("2 種類が上限を超えたら種類ごとに数える", () => {
    const warnings = [...ofKind("unregistered-impl", 25), ...ofKind("possible-contradiction", 13)];

    const result = selectWarningsForDisplay(warnings);

    expect(result.hiddenByKind).toEqual({
      "unregistered-impl": 5,
      "possible-contradiction": 3,
    });
    expect(result.hiddenCount).toBe(8);
  });

  it("上限の無い種類は件数がいくつでも全件出し、数えない", () => {
    const warnings = [
      ...ofKind("unreviewed-draft", 300),
      ...ofKind("missing-then", 300),
      ...ofKind("step-order", 300),
      ...ofKind("duplicate-scenario-name", 300),
    ];

    const result = selectWarningsForDisplay(warnings);

    expect(result.shown).toEqual(warnings);
    expect(result.hiddenByKind).toEqual({});
    expect(result.hiddenCount).toBe(0);
  });

  it("上限ちょうどなら何も隠さない", () => {
    const result = selectWarningsForDisplay(ofKind("unregistered-impl", 20));

    expect(result.hiddenByKind).toEqual({});
  });
});

describe("describeHiddenWarnings", () => {
  const ofKind = (kind: DriftWarning["kind"], length: number): DriftWarning[] =>
    Array.from({ length }, (_, i) => ({ kind, path: `p${i}`, message: `${kind} ${i}` }));

  it("省いた種類名・表示した件数と全体の件数・--json の案内を出す", () => {
    const warnings = [...ofKind("unregistered-impl", 701), ...ofKind("missing-then", 3)];

    const lines = describeHiddenWarnings(selectWarningsForDisplay(warnings));

    expect(lines).toEqual([
      "...and 681 more unregistered-impl (shown 20 of 701; run with --json for the full list)",
    ]);
  });

  it("省いた種類が複数なら種類ごとに 1 行ずつ出す", () => {
    const warnings = [...ofKind("possible-contradiction", 13), ...ofKind("unregistered-impl", 25)];

    const lines = describeHiddenWarnings(selectWarningsForDisplay(warnings));

    expect(lines).toEqual([
      "...and 3 more possible-contradiction (shown 10 of 13; run with --json for the full list)",
      "...and 5 more unregistered-impl (shown 20 of 25; run with --json for the full list)",
    ]);
  });

  it("check のまとめの 1 件（truncated）は表示した件数にも全体の件数にも数えない", () => {
    const summary: DriftWarning = {
      kind: "unknown-config-key",
      truncated: true,
      path: "specproof.config.yaml",
      message: "more than 100 unknown keys",
    };
    const warnings = [...ofKind("unknown-config-key", 100), summary];

    const display = selectWarningsForDisplay(warnings);

    expect(display.shown).toContain(summary);
    expect(describeHiddenWarnings(display)).toEqual([
      "...and 80 more unknown-config-key (shown 20 of 100; run with --json for the full list)",
    ]);
  });

  it("上限を超えていなければ何も出さない", () => {
    const warnings = [...ofKind("unregistered-impl", 20), ...ofKind("unreviewed-draft", 500)];

    expect(describeHiddenWarnings(selectWarningsForDisplay(warnings))).toEqual([]);
  });
});
