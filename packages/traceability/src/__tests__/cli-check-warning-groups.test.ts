import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import type { DriftWarning } from "../check.js";
import {
  describeWarningSummary,
  orderWarningsByGroup,
  warningGroup,
} from "../cli-check-warning-groups.js";

// warning が種類を問わず 1 つの列に並ぶと、本当の書き方の誤り（step-order など）が多数の参考の中に埋もれ、
// 直すきっかけにならない。「直すもの」と「参考」に分け、直すものを先に出す。

const warning = (kind: DriftWarning["kind"], message: string = kind): DriftWarning => ({
  kind,
  message,
});

test("feature の書き方の誤りは、--strict で落ちない設定でも直すものに入る", () => {
  for (const kind of [
    "missing-then",
    "step-order",
    "duplicate-scenario-name",
    "duplicate-scenario",
  ] as const) {
    assert.equal(warningGroup(kind), "fix", kind);
  }
});

test("未登録の実装・見出しと矛盾の候補は参考。opt-in で --strict の対象にしたものは直すもの", () => {
  for (const kind of [
    "unregistered-impl",
    "unregistered-spec-heading",
    "possible-contradiction",
  ] as const) {
    assert.equal(warningGroup(kind), "reference", kind);
  }
  assert.equal(warningGroup("unregistered-impl", { strictUnregisteredImpl: true }), "fix");
  assert.equal(
    warningGroup("unregistered-spec-heading", { strictUnregisteredSpecHeadings: true }),
    "fix",
  );
});

test("--strict で落ちる種類はすべて直すもの", () => {
  for (const kind of [
    "empty-link",
    "unreviewed-draft",
    "missing-reason",
    "disallowed-tag",
    "unregistered-feature",
    "duplicate-heading",
    "features-dir-unset",
    "features-dir-missing",
    "unknown-config-key",
  ] as const) {
    assert.equal(warningGroup(kind), "fix", kind);
  }
});

test("直すもの（--strict で落ちるもの、[advisory] の順）、参考の順に、同じ段の中は元の順に並べる", () => {
  const ordered = orderWarningsByGroup([
    warning("unregistered-spec-heading", "h1"),
    warning("step-order", "s1"),
    warning("possible-contradiction", "p1"),
    warning("empty-link", "e1"),
    warning("step-order", "s2"),
  ]);
  assert.deepEqual(
    ordered.map((item) => item.message),
    ["e1", "s1", "s2", "h1", "p1"],
  );
});

test("件数のまとめは、組ごとに種類と件数を多い順に出す。該当の無い組は出さない", () => {
  const warnings = [
    ...Array.from({ length: 3 }, () => warning("step-order")),
    warning("missing-then"),
    ...Array.from({ length: 5 }, () => warning("unregistered-spec-heading")),
    ...Array.from({ length: 2 }, () => warning("possible-contradiction")),
  ];
  assert.equal(
    describeWarningSummary(warnings),
    "Warnings: 4 to fix (step-order 3, missing-then 1); 7 for reference (unregistered-spec-heading 5, possible-contradiction 2)",
  );
  assert.equal(
    describeWarningSummary([warning("unregistered-impl")]),
    "Warnings: 1 for reference (unregistered-impl 1)",
  );
  assert.equal(describeWarningSummary([]), undefined);
});

test("check 自身のまとめの 1 件（truncated）は件数に数えない", () => {
  assert.equal(
    describeWarningSummary([
      warning("unknown-config-key"),
      { ...warning("unknown-config-key"), truncated: true },
    ]),
    "Warnings: 1 to fix (unknown-config-key 1)",
  );
});

const checkCli = fileURLToPath(new URL("../../dist/cli-check.js", import.meta.url));

test("check のテキストは件数のまとめと組の見出しを出し、注釈も直すものを先にする", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-warning-groups-"));
  try {
    mkdirSync(path.join(root, "docs"));
    mkdirSync(path.join(root, "features"));
    writeFileSync(
      path.join(root, "specproof.config.yaml"),
      "layout:\n  manifest: traceability.yaml\n  featuresDir: features\n",
    );
    // 登録した節 A の隣に、未登録の節 B がある（参考）。
    writeFileSync(path.join(root, "docs/spec.md"), "# Spec\n\n## A\n\na\n\n## B\n\nb\n");
    // 「ならば」の後にもう一度「もし」がある（直すもの）。
    writeFileSync(
      path.join(root, "features/a.feature"),
      [
        "Feature: A",
        "",
        // 前提と操作が同じで確認だけが違う組（矛盾の候補。参考）を先に置く。
        "  Scenario: shown",
        "    Given x",
        "    When y",
        "    Then it is shown",
        "",
        "  Scenario: hidden",
        "    Given x",
        "    When y",
        "    Then it is hidden",
        "",
        "  Scenario: order",
        "    Given p",
        "    When q",
        "    Then r",
        "    When again",
        "    Then done",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(root, "traceability.yaml"),
      "version: 1\nlinks:\n  - id: a\n    label: A\n    spec:\n      - path: docs/spec.md\n        heading: A\n        hash: PENDING\n    impl: []\n    features:\n      - path: features/a.feature\n        hash: PENDING\n",
    );
    const run = (args: string[]) =>
      spawnSync(process.execPath, [checkCli, "--root", root, ...args], {
        encoding: "utf8",
        timeout: 10_000,
      });
    const text = run([]).stdout;
    assert.match(
      text,
      /^Warnings: 1 to fix \(step-order 1\); 2 for reference \(possible-contradiction 1, unregistered-spec-heading 1\)$/m,
    );
    const fix = text.indexOf("To fix:");
    const reference = text.indexOf("For reference:");
    assert.ok(fix >= 0 && reference > fix, text);
    // 元の順（--json）では矛盾の候補（参考）が先に来る。テキストでは直すものの組の中に step-order だけが出る。
    const kinds = JSON.parse(run(["--json"]).stdout).warnings.map(
      (item: { kind: string }) => item.kind,
    );
    assert.ok(
      kinds.indexOf("possible-contradiction") < kinds.indexOf("step-order"),
      kinds.join(","),
    );
    assert.match(text.slice(fix, reference), /When/);
    assert.doesNotMatch(text.slice(fix, reference), /docs\/spec\.md|contradict/i);
    const annotations = run(["--github-annotations"])
      .stderr.split("\n")
      .filter((line) => line.startsWith("::warning::"));
    // 元の順では矛盾の候補（参考）が step-order より先。注釈では step-order が先に来る。
    const orderIndex = annotations.findIndex((line) => /When/.test(line) && /Then/.test(line));
    const contradictionIndex = annotations.findIndex((line) => /contradict/i.test(line));
    assert.ok(orderIndex >= 0 && contradictionIndex > orderIndex, annotations.join("\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("件数のまとめは opt-in で --strict の対象にした種類を直すものに数える", () => {
  assert.equal(
    describeWarningSummary([warning("unregistered-impl"), warning("possible-contradiction")], {
      strictUnregisteredImpl: true,
    }),
    "Warnings: 1 to fix (unregistered-impl 1); 1 for reference (possible-contradiction 1)",
  );
});

test("直すものの中では --strict で落ちるものを先にする", () => {
  const ordered = orderWarningsByGroup([
    warning("step-order", "advisory"),
    warning("empty-link", "hard"),
  ]);
  assert.deepEqual(
    ordered.map((item) => item.message),
    ["hard", "advisory"],
  );
});

test("隠した直すものの件数の行は、参考の見出しより前に出す", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-warning-groups-hidden-"));
  try {
    mkdirSync(path.join(root, "features"));
    // 未知の設定キー（直すもの。表示は 20 件まで）を 25 件と、未登録の feature を置く。
    const keys = Array.from({ length: 25 }, (_, index) => `unknownKey${index}: 1`).join("\n");
    writeFileSync(
      path.join(root, "specproof.config.yaml"),
      `layout:\n  manifest: traceability.yaml\n  featuresDir: features\n${keys}\n`,
    );
    writeFileSync(path.join(root, "traceability.yaml"), "version: 1\nlinks: []\n");
    const text = spawnSync(process.execPath, [checkCli, "--root", root], {
      encoding: "utf8",
      timeout: 10_000,
    }).stdout;
    const hidden = text.indexOf("more unknown-config-key");
    assert.ok(hidden >= 0, text);
    const reference = text.indexOf("For reference:");
    assert.ok(reference < 0 || hidden < reference, text);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
