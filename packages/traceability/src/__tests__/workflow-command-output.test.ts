import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { neutralizeWorkflowCommands } from "../output.js";

// GitHub Actions のランナーは、ログの行頭（空白を除く）の `::name::` と、行のどこかにある
// `##[name]` をワークフローコマンドとして読む。link id・見出し・パスは PR の作者が書けるので、
// CLI の出力のどの行にもその形を残さない。
// 判定器は実装と独立に、ランナー（.NET の char.IsWhiteSpace）の空白の集合で行頭を詰める。
const DOTNET_WHITESPACE =
  /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*/u;
const isCommandLine = (line: string): boolean =>
  line.includes("##[") || line.replace(DOTNET_WHITESPACE, "").startsWith("::");

const assertNoCommandLines = (output: string, label: string): void => {
  for (const line of output.split(/\r\n|\r|\n/)) {
    assert.ok(!isCommandLine(line), `${label}: ${JSON.stringify(line)}`);
  }
};

const dist = (name: string): string =>
  fileURLToPath(new URL(`../../dist/cli-${name}.js`, import.meta.url));

const HOSTILE_IDS = ["##[warning]legacy", "::warning::v2", "  ::error::indented"];
const FEATURE = "features/::notice::f.feature";

const withRepo = (run: (root: string) => void): void => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-wfcmd-"));
  try {
    mkdirSync(path.join(root, "docs"));
    mkdirSync(path.join(root, "features"));
    writeFileSync(path.join(root, "docs/spec.md"), "# Doc\n\n## Spec\n\nbody\n");
    writeFileSync(
      path.join(root, FEATURE),
      "Feature: f\n  Scenario: ##[warning]scenario\n    Then ok\n",
    );
    const links = HOSTILE_IDS.map((id) => ({
      id,
      label: `##[group]${id}`,
      // 保存した hash は実体と合わないので、check は drift を、update は変更を報告する。
      spec: [{ path: "docs/spec.md", heading: "Spec", hash: "0".repeat(64) }],
      impl: [],
      features: [{ path: FEATURE, hash: "0".repeat(64) }],
    }));
    writeFileSync(path.join(root, "traceability.yaml"), JSON.stringify({ version: 1, links }));
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const cli = (root: string, name: string, args: string[]) => {
  const result = spawnSync(process.execPath, [dist(name), "--root", root, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  return result;
};

for (const [name, args] of [
  ["check", []],
  ["check", ["--json"]],
  ["check", ["--strict"]],
  ["update", ["--dry-run"]],
  ["list", []],
  ["list", ["--json"]],
  ["stats", []],
  ["stats", ["--json"]],
] as const) {
  test(`${name} ${args.join(" ")}: 出力のどの行もワークフローコマンドとして読まれない`, () =>
    withRepo((root) => {
      const result = cli(root, name, [...args]);
      assert.ok(result.stdout.length > 0, result.stderr);
      // 攻撃の入力が実際に出力へ届いていることを確かめる（届かなければ検査の意味が無い）。
      assert.match(result.stdout, /legacy|v2|indented|notice/);
      assertNoCommandLines(result.stdout, `${name} stdout`);
      assertNoCommandLines(result.stderr, `${name} stderr`);
    }));
}

// yaml は解決できないタグなどの警告を process.emitWarning で stderr に直接出す。タグ名は
// PR の作者が書けるので、警告も出口を通す（YAML の警告そのものは消さずに知らせる）。
const HOSTILE_TAG = "!<x##[error]\u001b[2J\u202etag>";
const withYamlTagRepo = (
  where: "config" | "manifest" | "none",
  run: (root: string) => void,
): void => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-yamlwarn-"));
  try {
    mkdirSync(path.join(root, "docs"));
    writeFileSync(path.join(root, "docs/spec.md"), "# Doc\n\n## Spec\n\nbody\n");
    writeFileSync(
      path.join(root, "specproof.config.yaml"),
      where === "config" ? `layout:\n  pagesDir: ${HOSTILE_TAG} pages\n` : "layout: {}\n",
    );
    const label = where === "manifest" ? `${HOSTILE_TAG} label` : "label";
    writeFileSync(
      path.join(root, "traceability.yaml"),
      [
        "version: 1",
        "links:",
        "  - id: a",
        `    label: ${label}`,
        "    spec:",
        "      - path: docs/spec.md",
        "        heading: Spec",
        `        hash: "${"0".repeat(64)}"`,
        "    impl: []",
        "    features: []",
        "",
      ].join("\n"),
    );
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

for (const where of ["config", "manifest"] as const) {
  for (const [name, args] of [
    ["check", []],
    ["update", []],
  ] as const) {
    test(`${where} の YAML の警告も出口を通す（${name}）`, () =>
      withYamlTagRepo(where, (root) => {
        const result = cli(root, name, [...args]);
        // 警告は消さずに、どのファイルの警告かを示して出す。
        assert.match(result.stderr, /Unresolved tag/, result.stderr);
        const file = where === "config" ? "specproof.config.yaml" : "traceability.yaml";
        assert.ok(result.stderr.includes(`warning: ${file}: `), result.stderr);
        // 端末の制御シーケンスと bidi 制御文字も残さない。
        assert.doesNotMatch(result.stderr, /[\u001b\u202e]/u);
        assertNoCommandLines(result.stdout, `${name} stdout`);
        assertNoCommandLines(result.stderr, `${name} stderr`);
      }));
  }
}

// yaml は toJS() の中でも、キーがコレクションのときに警告を process.emitWarning で直接出す
// （文字列にしたキーを含む）。警告の発生源は parse() の警告だけではない。
const COLLECTION_KEY = '? [ "##[add-mask]key" ]\n: 1\n';
for (const where of ["config", "manifest"] as const) {
  for (const name of ["check", "update"] as const) {
    test(`${where} のコレクションのキーの警告も stderr に直接出さない（${name}）`, () =>
      withYamlTagRepo("none", (root) => {
        const file = where === "config" ? "specproof.config.yaml" : "traceability.yaml";
        const target = path.join(root, file);
        writeFileSync(target, readFileSync(target, "utf8") + COLLECTION_KEY);
        const result = cli(root, name, []);
        assertNoCommandLines(result.stdout, `${name} stdout`);
        assertNoCommandLines(result.stderr, `${name} stderr`);
      }));
  }
}

test("JSON 出力は値を変えずに `##[` だけを読まれない書き方にする", () =>
  withRepo((root) => {
    const result = cli(root, "check", ["--json"]);
    const ids = (JSON.parse(result.stdout) as { entries: { linkId: string }[] }).entries.map(
      (entry) => entry.linkId,
    );
    assert.ok(ids.includes("##[warning]legacy"), result.stdout);
  }));

// 出口（output.ts）を通らない出力を増やさない。通さないのは、意図したコマンド（annotation）、
// SPECPROOF_DEBUG=1 で明示的に有効にしたスタックに限る。
test("CLI の出力は output.ts の出口を通す（例外は決めた箇所だけ）", () => {
  const src = fileURLToPath(new URL("..", import.meta.url));
  const direct = (readdirSync(src, { recursive: true }) as string[])
    .filter((name) => name.endsWith(".ts") && name !== "output.ts" && !name.startsWith("__tests__"))
    .flatMap((name) =>
      readFileSync(path.join(src, name), "utf8")
        .split("\n")
        .filter((line) => /\bconsole\b|\bprocess\.(stdout|stderr)\b/.test(line))
        .map((line) => `${name}: ${line.trim()}`),
    )
    .sort();
  assert.deepEqual(direct, [
    "cli-args.ts: console.error(error);",
    "cli-check.ts: console.error(toGithubAnnotation(entry));",
    "cli-check.ts: console.error(toGithubWarningAnnotation(warning));",
  ]);
});

test("neutralizeWorkflowCommands は行ごとに `##[` と行頭の `::` を崩す", () => {
  assert.equal(
    neutralizeWorkflowCommands("a ##[warning]x\n  ::error::y\r::notice::z\nok"),
    "a #?[warning]x\n  ?:error::y\r?:notice::z\nok",
  );
  assert.equal(neutralizeWorkflowCommands("###[x"), "##?[x");
  assert.equal(neutralizeWorkflowCommands("\u00a0::x"), "\u00a0?:x");
  // JS の trimStart は U+0085 を詰めないが、ランナーは詰める。
  assert.equal(neutralizeWorkflowCommands("\u0085::x"), "\u0085?:x");
  assert.ok(!isCommandLine(neutralizeWorkflowCommands("\u3000\u0085::x")));
});

// 設定ファイルのキーは PR の作者が書ける。unknown-config-key の警告に出すキーも出口を通し、
// 端末の制御シーケンスと bidi 制御文字も残さない。
const HOSTILE_KEYS = [
  "::error::top",
  "##[warning]key",
  "  ::notice::indented",
  "x\u001b[2J\u202ey\n::error::z",
];
for (const args of [[], ["--strict"], ["--json"], ["--github-annotations"]]) {
  test(`check ${args.join(" ")}: 設定の未知のキーもワークフローコマンドとして読まれない`, () =>
    withRepo((root) => {
      const hostile = Object.fromEntries(HOSTILE_KEYS.map((key) => [key, 1]));
      writeFileSync(
        path.join(root, "specproof.config.yaml"),
        JSON.stringify({
          layout: { manifest: "traceability.yaml", featuresDir: "features", ...hostile },
          ...hostile,
        }),
      );
      const result = cli(root, "check", args);
      const output = result.stdout + result.stderr;
      // 攻撃の入力が実際に出力へ届いていることを確かめる。
      assert.match(output, /top/);
      assert.match(output, /indented/);
      assert.doesNotMatch(output, /[\u001b\u202e]/u);
      assertNoCommandLines(result.stdout, "check stdout");
      // --github-annotations は意図した `::warning::` を stderr に出す。キーから行を増やさない。
      const lines = result.stderr.split(/\r\n|\r|\n/).filter((line) => line !== "");
      for (const line of lines) {
        assert.ok(
          !isCommandLine(line) ||
            line.startsWith("::warning::specproof traceability: ") ||
            line.startsWith("::warning file="),
          JSON.stringify(line),
        );
      }
    }));
}
