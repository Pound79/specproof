import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, test } from "vitest";

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

const MANIFEST = `version: 1
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
`;

// manifest をサブディレクトリ（e2e/）に置き、設定ファイルがルートでそれを指す構成。
describe("manifest がサブディレクトリにあるときのルートの解決", () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "specproof-root-")));
    mkdirSync(path.join(root, "e2e"));
    mkdirSync(path.join(root, "docs"));
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "docs", "spec.md"), "# Spec\n\n## Rules\n\nAllowed.\n");
    writeFileSync(path.join(root, "src", "a.ts"), "export {};\n");
    writeFileSync(
      path.join(root, "specproof.config.yaml"),
      'layout:\n  manifest: "e2e/traceability.yaml"\n',
    );
    writeFileSync(path.join(root, "e2e", "traceability.yaml"), MANIFEST);
    const blessed = run(updateCli, root);
    assert.equal(blessed.status, 0, blessed.stderr);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("manifest のあるディレクトリから流しても、設定ファイルのあるルートで検査する", () => {
    const result = run(checkCli, path.join(root, "e2e"));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /clean/);
    assert.doesNotMatch(result.stdout, /BOTH spec and impl changed/);
  });

  test("参照がすべて missing なら BOTH changed を出さず、ルートの取り違えを疑う案内を出す", () => {
    const result = run(checkCli, root, ["--root", path.join(root, "e2e")]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /BOTH spec and impl changed/);
    assert.match(result.stdout, /all 2 reference\(s\) .*missing/);
    assert.match(result.stdout, /--root/);
    // 同期と update を勧めると、ルートを確かめる案内と矛盾する。
    assert.doesNotMatch(result.stdout, /then run: specproof-update/);
  });

  test("見出しだけが消えた spec はルートの取り違えとみなさず、従来どおり BOTH changed を出す", () => {
    writeFileSync(path.join(root, "docs", "spec.md"), "# Spec\n\n## Renamed\n\nAllowed.\n");
    rmSync(path.join(root, "src", "a.ts"));
    // spec は SECTION_MISSING、impl は FILE_MISSING。ルートを取り違えると spec もファイルごと無くなる。
    const result = run(checkCli, root);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /BOTH spec and impl changed/);
    assert.doesNotMatch(result.stdout, /reference\(s\) .*missing/);
  });

  test("参照がすべて missing なら --github-annotations にもルートを確かめる案内を出す", () => {
    const result = run(checkCli, root, ["--root", path.join(root, "e2e"), "--github-annotations"]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /^::warning::.*reference\(s\) .*missing.*--root/m);
    // 注釈は CI のログと PR に出るので、runner の絶対パスを載せない。
    assert.ok(!result.stderr.includes(root), result.stderr);
  });

  test("全参照 missing が 10 件以上でも、ルートの案内を先頭の注釈にし、同期と update を勧める注釈は出さない", () => {
    // GitHub Actions は 1 step の warning 注釈を 10 件までしか表示しない。
    const impl = Array.from(
      { length: 12 },
      (_, i) => `      - path: src/gone${i}.ts\n        hash: PENDING\n`,
    ).join("");
    writeFileSync(
      path.join(root, "e2e", "traceability.yaml"),
      `version: 1\nlinks:\n  - id: many\n    label: Many\n    spec: []\n    impl:\n${impl}    features: []\n`,
    );
    const result = run(checkCli, root, ["--github-annotations"]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const annotations = result.stderr.split("\n").filter((line) => line.startsWith("::"));
    assert.match(annotations[0] ?? "", /^::warning::.*all 12 reference\(s\) .*missing.*--root/);
    assert.ok(
      annotations.every((line) => !/specproof-update|specproof-sync/.test(line)),
      annotations.join("\n"),
    );
  });

  test("参照がすべて missing なら --json の bothSidesChanged を空にし、allReferencesMissing を立てる", () => {
    const result = run(checkCli, root, ["--root", path.join(root, "e2e"), "--json"]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.bothSidesChanged, []);
    assert.equal(report.allReferencesMissing, true);
  });

  test("一部だけ missing なら従来どおり BOTH changed を出す", () => {
    writeFileSync(path.join(root, "docs", "spec.md"), "# Spec\n\n## Rules\n\nDenied.\n");
    rmSync(path.join(root, "src", "a.ts"));
    // spec は changed、impl は missing。全部 missing ではないので両側の変更として止める。
    const result = run(checkCli, root);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /BOTH spec and impl changed/);
    assert.doesNotMatch(result.stdout, /reference\(s\) .*missing/);
    const json = JSON.parse(run(checkCli, root, ["--json"]).stdout);
    assert.equal(json.allReferencesMissing, false);
    // 全部 missing でなければ、参照ごとの注釈を従来どおり出し、ルートの案内は出さない。
    const annotated = run(checkCli, root, ["--github-annotations"]);
    assert.match(annotated.stderr, /^::warning file=docs\/spec\.md::/m);
    assert.match(annotated.stderr, /^::warning file=src\/a\.ts::/m);
    assert.doesNotMatch(annotated.stderr, /reference\(s\) .*missing/);
  });

  test("さらに下のディレクトリから流しても同じルートになる", () => {
    mkdirSync(path.join(root, "e2e", "steps"));
    const result = run(checkCli, path.join(root, "e2e", "steps"));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /clean/);
  });
});
