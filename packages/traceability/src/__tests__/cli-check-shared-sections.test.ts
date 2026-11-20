import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import type { DriftEntry } from "../check.js";
import { describeSharedSpecSections } from "../cli-check-format.js";

// 共通の決まりを書いた節を多くのリンクが参照していると、関係の無い変更で全リンクが drift し、
// リンクごとの一覧からは「どの節が変わったか」が読み取れない。節ごとにまとめて示す。

const specEntry = (
  linkId: string,
  heading: string,
  options: Partial<Pick<DriftEntry, "path" | "status" | "storedHash">> = {},
): DriftEntry => ({
  linkId,
  side: "spec",
  path: options.path ?? "docs/spec.md",
  heading,
  storedHash: options.storedHash ?? "a".repeat(64),
  currentHash: "b".repeat(64),
  status: options.status ?? "changed",
});

test("2 つ以上のリンクで変わった節を、リンクの数の多い順にまとめる", () => {
  const lines = describeSharedSpecSections([
    specEntry("a", "Other"),
    specEntry("b", "Other"),
    specEntry("a", "Common"),
    specEntry("b", "Common"),
    specEntry("c", "Common", { path: "./docs/spec.md" }),
    specEntry("d", "Single"),
  ]);
  assert.deepEqual(lines, [
    "Spec sections that drifted in several links:",
    "  docs/spec.md § Common — 3 link(s)",
    "  docs/spec.md § Other — 2 link(s)",
  ]);
});

test("1 つのリンクだけの節、missing、PENDING は数えず、該当が無ければ何も出さない", () => {
  assert.deepEqual(
    describeSharedSpecSections([
      specEntry("a", "Common", { status: "missing" }),
      specEntry("b", "Common", { status: "missing" }),
      specEntry("a", "Pending", { storedHash: "PENDING" }),
      specEntry("b", "Pending", { storedHash: "PENDING" }),
      specEntry("a", "Single"),
    ]),
    [],
  );
});

test("節の数が多いときは上限まで出し、残りの数を示す。見出しの制御文字は表示しない", () => {
  const entries = Array.from({ length: 12 }, (_, index) => [
    specEntry("a", `S${index}`),
    specEntry("b", `S${index}`),
  ]).flat();
  const lines = describeSharedSpecSections(entries);
  assert.equal(lines.length, 1 + 10 + 1);
  assert.match(lines.at(-1) ?? "", /and 2 more section\(s\)/);
  const escaped = describeSharedSpecSections([
    specEntry("a", "X\u001b[31m"),
    specEntry("b", "X\u001b[31m"),
  ]);
  assert.doesNotMatch(escaped.join("\n"), /\u001b/);
});

const checkCli = fileURLToPath(new URL("../../dist/cli-check.js", import.meta.url));
const updateCli = fileURLToPath(new URL("../../dist/cli-update.js", import.meta.url));

test("check のテキスト出力に、節ごとのまとめを Next の前に出し、--json は変えない", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-shared-sections-"));
  try {
    mkdirSync(path.join(root, "docs"));
    writeFileSync(path.join(root, "docs/spec.md"), "# Spec\n\n## Common\n\nrule one\n");
    const link = (id: string) =>
      `  - id: ${id}\n    label: ${id}\n    spec:\n      - path: docs/spec.md\n        heading: Common\n        hash: PENDING\n    impl: []\n    features: []\n`;
    writeFileSync(
      path.join(root, "traceability.yaml"),
      `version: 1\nlinks:\n${link("a")}${link("b")}`,
    );
    const run = (cli: string, args: string[]) =>
      spawnSync(process.execPath, [cli, "--root", root, ...args], {
        encoding: "utf8",
        timeout: 10_000,
      });
    assert.equal(run(updateCli, []).status, 0);
    writeFileSync(path.join(root, "docs/spec.md"), "# Spec\n\n## Common\n\nrule one\n\nrule two\n");
    const text = run(checkCli, []).stdout;
    const summary = text.indexOf("Spec sections that drifted in several links:");
    assert.ok(summary >= 0, text);
    assert.match(text, /docs\/spec\.md § Common — 2 link\(s\)/);
    assert.ok(summary < text.indexOf("Next:"), "まとめは Next の前");
    const json = JSON.parse(run(checkCli, ["--json"]).stdout);
    assert.equal("sharedSpecSections" in json, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
