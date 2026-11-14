import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
    timeout: 20_000,
  });
  assert.ifError(result.error);
  return result;
};

// 利用者の git 設定（署名・フック）に左右されないように、空の設定でコミットする。
const git = (cwd: string, args: string[]): string =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=specproof-test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } },
  ).trim();

const commitAll = (cwd: string, message: string): string => {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
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

// drift が出たとき、前に bless した中身がどのコミットにあるかを CLI から辿れるようにする。
describe("specproof-check --since-bless", () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "specproof-since-bless-")));
    mkdirSync(path.join(root, "docs"));
    mkdirSync(path.join(root, "src"));
    git(root, ["init", "-q"]);
    writeFileSync(path.join(root, "docs", "spec.md"), "# Spec\n\n## Rules\n\nAllowed.\n");
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(path.join(root, "traceability.yaml"), MANIFEST);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("impl の drift に、bless した中身と同じ版のコミットと git diff の形を出す", () => {
    const blessedCommit = commitAll(root, "v1");
    assert.equal(run(updateCli, root).status, 0);
    commitAll(root, "bless");
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 2;\n");
    commitAll(root, "v2");
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 3;\n");

    const result = run(checkCli, root, ["--since-bless"]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, new RegExp(`blessed version: ${blessedCommit}`));
    assert.ok(
      result.stdout.includes(`git diff ${blessedCommit} -- ':(top,literal)src/a.ts'`),
      result.stdout,
    );
  });

  test("spec は見出しの節の hash で探し、同じ文書のほかの節の変更に惑わされない", () => {
    const blessedCommit = commitAll(root, "v1");
    assert.equal(run(updateCli, root).status, 0);
    writeFileSync(
      path.join(root, "docs", "spec.md"),
      "# Spec\n\n## Rules\n\nAllowed.\n\n## Other\n\nAdded later.\n",
    );
    commitAll(root, "other section");
    writeFileSync(
      path.join(root, "docs", "spec.md"),
      "# Spec\n\n## Rules\n\nDenied.\n\n## Other\n\nAdded later.\n",
    );

    const result = run(checkCli, root, ["--since-bless", "--json"]);
    const report = JSON.parse(result.stdout);
    const spec = report.entries.find((entry: { side: string }) => entry.side === "spec");
    // 最も新しい一致は「other section」のコミット（Rules の節は v1 と同じ）。
    assert.equal(spec.blessedCommit, git(root, ["rev-parse", "HEAD"]));
    assert.notEqual(spec.blessedCommit, undefined);
    assert.ok(blessedCommit);
  });

  test("bless した中身がどのコミットにも無ければ、見つからないと出す", () => {
    commitAll(root, "v1");
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 9;\n");
    // コミットしていない中身で bless する。
    assert.equal(run(updateCli, root).status, 0);
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 10;\n");

    const result = run(checkCli, root, ["--since-bless", "--json"]);
    const impl = JSON.parse(result.stdout).entries.find(
      (entry: { side: string }) => entry.side === "impl",
    );
    assert.equal(impl.blessedCommit, null);
    const text = run(checkCli, root, ["--since-bless"]).stdout;
    assert.match(
      text,
      /blessed version: not found in the last \d+ commit\(s\) touching src\/a\.ts/,
    );
  });

  test("フラグが無ければ git を見ず、出力も --json も変えない", () => {
    commitAll(root, "v1");
    assert.equal(run(updateCli, root).status, 0);
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 2;\n");
    const result = run(checkCli, root, ["--json"]);
    const impl = JSON.parse(result.stdout).entries[0];
    assert.equal("blessedCommit" in impl, false);
    assert.doesNotMatch(run(checkCli, root).stdout, /blessed version/);
  });

  test("git の管理下でなければ、履歴を辿れないと 1 行で出し、check の結果は変えない", () => {
    rmSync(path.join(root, ".git"), { recursive: true, force: true });
    assert.equal(run(updateCli, root).status, 0);
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 2;\n");
    const result = run(checkCli, root, ["--since-bless"]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /git history is not available/);
  });

  test("設定のルートが git の最上位より下でも、示した git diff はどこから流しても中身の差分を出す", () => {
    const top = root;
    const sub = path.join(top, "e2e");
    mkdirSync(path.join(sub, "docs"), { recursive: true });
    mkdirSync(path.join(sub, "src"), { recursive: true });
    writeFileSync(path.join(sub, "docs", "spec.md"), "# Spec\n\n## Rules\n\nAllowed.\n");
    writeFileSync(path.join(sub, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(path.join(sub, "traceability.yaml"), MANIFEST);
    const blessedCommit = commitAll(top, "v1");
    assert.equal(run(updateCli, sub).status, 0);
    writeFileSync(path.join(sub, "src", "a.ts"), "export const a = 2;\n");

    const result = run(checkCli, sub, ["--since-bless"]);
    const command = `git diff ${blessedCommit} -- ':(top,literal)e2e/src/a.ts'`;
    assert.ok(result.stdout.includes(command), result.stdout);
    // 示した形で git の最上位からも、設定のルートからも、同じ差分が出る。
    for (const cwd of [top, sub]) {
      const diff = git(cwd, ["diff", blessedCommit, "--", ":(top,literal)e2e/src/a.ts"]);
      assert.match(diff, /export const a = 2/);
    }
  });

  test("シェルで扱いにくい文字を含むパスはコマンドの形で示さず、コミットとパスを分けて示す", () => {
    writeFileSync(path.join(root, "src", "x'; echo pwned; '.ts"), "export const b = 1;\n");
    writeFileSync(
      path.join(root, "traceability.yaml"),
      MANIFEST.replace("src/a.ts", "\"src/x'; echo pwned; '.ts\""),
    );
    const blessedCommit = commitAll(root, "v1");
    assert.equal(run(updateCli, root).status, 0);
    writeFileSync(path.join(root, "src", "x'; echo pwned; '.ts"), "export const b = 2;\n");
    const result = run(checkCli, root, ["--since-bless"]);
    assert.match(result.stdout, new RegExp(`blessed version: ${blessedCommit}`));
    assert.doesNotMatch(result.stdout, /git diff/);
  });

  test("リポジトリ内のシンボリックリンクの参照も、実体と同じコミットを見つけ、実体のパスで差分を示す", () => {
    symlinkSync("a.ts", path.join(root, "src", "alias.ts"));
    writeFileSync(
      path.join(root, "traceability.yaml"),
      MANIFEST.replace(
        "      - path: src/a.ts\n        hash: PENDING\n",
        "      - path: src/a.ts\n        hash: PENDING\n      - path: src/alias.ts\n        hash: PENDING\n",
      ),
    );
    const blessedCommit = commitAll(root, "v1");
    assert.equal(run(updateCli, root).status, 0);
    writeFileSync(path.join(root, "src", "a.ts"), "export const a = 2;\n");
    commitAll(root, "v2");

    const report = JSON.parse(run(checkCli, root, ["--since-bless", "--json"]).stdout);
    type Entry = { path: string; blessedCommit?: string | null; blessedPath?: string };
    const entries: Entry[] = report.entries;
    const real = entries.find((entry) => entry.path === "src/a.ts");
    const alias = entries.find((entry) => entry.path === "src/alias.ts");
    assert.equal(real?.blessedCommit, blessedCommit);
    assert.equal(alias?.blessedCommit, blessedCommit);
    assert.equal(alias?.blessedPath, "src/a.ts");
    assert.equal(real !== undefined && "blessedPath" in real, false);

    const text = run(checkCli, root, ["--since-bless"]).stdout;
    assert.ok(!text.includes("':(top,literal)src/alias.ts'"), text);
  });

  test("リンク先のパスがコマンドにできない文字を含んでも、テキストに実体のパスを示す", () => {
    writeFileSync(path.join(root, "src", "a b.ts"), "export const value = 1;\n");
    symlinkSync("a b.ts", path.join(root, "src", "alias.ts"));
    writeFileSync(
      path.join(root, "traceability.yaml"),
      MANIFEST.replace("src/a.ts", "src/alias.ts"),
    );
    const blessedCommit = commitAll(root, "v1");
    assert.equal(run(updateCli, root).status, 0);
    writeFileSync(path.join(root, "src", "a b.ts"), "export const value = 2;\n");
    commitAll(root, "v2");

    const text = run(checkCli, root, ["--since-bless"]).stdout;
    assert.match(text, new RegExp(`blessed version: ${blessedCommit}`));
    assert.ok(text.includes('"src/a b.ts"'), text);
    assert.doesNotMatch(text, /git diff/);
  });
});
