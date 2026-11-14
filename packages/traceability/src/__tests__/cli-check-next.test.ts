import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, test } from "vitest";
import type { DriftEntry } from "../check.js";
import { describeNextSteps, toGithubAnnotation } from "../cli-check-format.js";

const entry = (side: DriftEntry["side"], linkId = "login"): DriftEntry => ({
  linkId,
  side,
  path: side === "spec" ? "docs/spec.md" : side === "impl" ? "src/login.ts" : "e2e/login.feature",
  storedHash: "a".repeat(64),
  currentHash: "b".repeat(64),
  status: "changed",
});

// drift の後に link を指定せずに specproof-update を流すと、動きが変わった実装まで黙って bless する。
describe("describeNextSteps", () => {
  test("リンクごとに --link-id を付けて bless する形を示し、引数なしの specproof-update を勧めない", () => {
    const lines = describeNextSteps([entry("spec")]);
    const text = lines.join("\n");
    assert.match(text, /specproof-update --link-id <link-id>/);
    assert.doesNotMatch(text, /specproof-update(?! --link-id)/);
  });

  test("impl の drift があれば、動きが変わったなら sync の決定表で判断してから bless するよう添える", () => {
    const text = describeNextSteps([entry("spec"), entry("impl", "other")]).join("\n");
    assert.match(text, /\[impl\]/);
    assert.match(text, /observable behavior/);
    assert.match(text, /specproof-sync decision table/);
  });

  test("impl の drift が無ければ決定表の添え書きを出さない", () => {
    const text = describeNextSteps([entry("spec"), entry("feature")]).join("\n");
    assert.doesNotMatch(text, /decision table/);
  });
});

describe("toGithubAnnotation の bless の案内", () => {
  test("引数なしの specproof-update ではなく --link-id の形を出す", () => {
    const annotation = toGithubAnnotation(entry("spec"));
    assert.match(annotation, /specproof-update --link-id <link-id>/);
    assert.doesNotMatch(annotation, /specproof-update(?! --link-id)/);
  });

  test("impl の drift には sync の決定表で判断するよう添える", () => {
    assert.match(toGithubAnnotation(entry("impl")), /specproof-sync decision table/);
    assert.doesNotMatch(toGithubAnnotation(entry("spec")), /decision table/);
  });
});

const checkCli = fileURLToPath(new URL("../../dist/cli-check.js", import.meta.url));
const updateCli = fileURLToPath(new URL("../../dist/cli-update.js", import.meta.url));

const run = (cli: string, cwd: string, args: string[] = []) => {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  return result;
};

describe("specproof-check のテキスト出力の Next", () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "specproof-next-")));
    mkdirSync(path.join(root, "docs"));
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "docs", "spec.md"), "# Spec\n\n## Rules\n\nAllowed.\n");
    writeFileSync(path.join(root, "src", "a.ts"), "export {};\n");
    writeFileSync(
      path.join(root, "traceability.yaml"),
      `version: 1
links:
  - id: perm
    label: Permissions
    spec:
      - path: docs/spec.md
        heading: "Rules"
        hash: PENDING
    impl:
      - path: src/a.ts
        hash: PENDING
    features: []
`,
    );
    const blessed = run(updateCli, root);
    assert.equal(blessed.status, 0, blessed.stderr);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("impl だけが drift したとき、--link-id の形と決定表の添え書きを出す", () => {
    writeFileSync(path.join(root, "src", "a.ts"), "export const changed = 1;\n");
    const result = run(checkCli, root);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /specproof-update --link-id <link-id>/);
    assert.match(result.stdout, /specproof-sync decision table/);
    assert.doesNotMatch(result.stdout, /then run: specproof-update/);
  });
});
