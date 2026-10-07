import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, vi } from "vitest";
import { parse } from "yaml";
import { runInit, scaffoldTemplate } from "../init.js";

const templates = fileURLToPath(new URL("../../../templates/", import.meta.url));

test("空白を含む配置名でも生成コマンドは実際の E2E 配置先で動く", () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "specproof-quoted-path-")));
  try {
    const dir = "e2e tests";
    const target = path.join(root, dir);
    scaffoldTemplate({
      tplDir: path.join(templates, "playwright"),
      repoRoot: root,
      e2eDir: target,
      templateDefaultDir: "packages/e2e",
      force: false,
    });
    const config = parse(readFileSync(path.join(root, "specproof.config.yaml"), "utf8"));
    assert.equal(config.layout.e2eRoot, dir);
    assert.equal(config.layout.featuresDir, `${dir}/features`);
    const bin = path.join(root, "stub-bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "npm"), '#!/bin/sh\nprintf "%s\\n" "$PWD"\n', { mode: 0o755 });
    const result = spawnSync("/bin/bash", ["-c", config.commands.install], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: bin, LC_ALL: "C" },
      timeout: 5_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), target);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const directories = [
  ".",
  "..foo",
  "custom-bdd",
  "e2e tests",
  "e2e: tests",
  'e2e"tests',
  "e2e'tests",
  "$(touch injected-marker)",
  "tests; touch injected-marker; #",
  "tests & touch injected-marker &",
  "tests`touch injected-marker`",
  "試験: 認証'画面",
  "-tests",
  "-",
];

for (const [adapter, defaultDir] of [
  ["playwright", "packages/e2e"],
  ["flutter", "bdd_tests"],
]) {
  for (const dir of [...directories, defaultDir]) {
    test(`${adapter}/${dir}: YAML の配置先と実コマンドの cwd が一致し副作用が生じない`, () => {
      const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "specproof-path-corpus-")));
      try {
        const target = path.resolve(root, dir);
        scaffoldTemplate({
          tplDir: path.join(templates, adapter),
          repoRoot: root,
          e2eDir: target,
          templateDefaultDir: defaultDir,
          force: false,
        });
        const text = readFileSync(path.join(root, "specproof.config.yaml"), "utf8");
        const config = parse(text);
        assert.equal(path.resolve(root, config.layout.e2eRoot), target);
        for (const key of [
          "featuresDir",
          "stepsDir",
          "pagesDir",
          "manifest",
          "e2eReadme",
          "testRunnerConfig",
          "idiomGuide",
        ]) {
          assert.ok(existsSync(path.resolve(root, config.layout[key])), key);
        }
        assert.match(text, /#.*traceability/);
        const bin = path.join(root, "stub-bin");
        mkdirSync(bin);
        for (const name of ["npm", "flutter", "dart"]) {
          writeFileSync(path.join(bin, name), '#!/bin/sh\nprintf "%s\\n" "$PWD"\n', {
            mode: 0o755,
          });
        }
        // 想定外の実行は本物のコマンドへ渡さず、観測用マーカーを残す。
        writeFileSync(
          path.join(bin, "touch"),
          '#!/bin/sh\nprintf "injected\\n" > "$SCAFFOLD_TEST_MARKER"\n',
          { mode: 0o755 },
        );
        const marker = path.join(root, "injected-marker");
        const commandKeys = ["install", "generate", "typecheck", "lint", "smoke"];
        // 各コマンドを独立した subshell で repo root から実行する。
        const script =
          "set -e\n" + commandKeys.map((key) => `(${config.commands[key]})`).join("\n");
        const result = spawnSync("/bin/bash", ["-c", script], {
          cwd: root,
          encoding: "utf8",
          env: { PATH: bin, LC_ALL: "C", SCAFFOLD_TEST_MARKER: marker },
          timeout: 10_000,
        });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(existsSync(marker), false);
        assert.ok(result.stdout.trim().split("\n").length >= commandKeys.length);
        for (const cwd of result.stdout.trim().split("\n")) assert.equal(cwd, target);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }, 20_000);
  }
}

for (const [adapter, defaultDir] of [
  ["playwright", "packages/e2e"],
  ["flutter", "bdd_tests"],
]) {
  for (const dir of [".", "-", "custom-bdd", "e2e tests", defaultDir]) {
    test(`${adapter}/${dir}: OLDPWD と CDPATH の外部配置先で生成コマンドを実行しない`, async () => {
      const fixture = realpathSync(
        mkdtempSync(path.join(os.tmpdir(), "specproof-cd-environment-")),
      );
      const root = path.join(fixture, "repo");
      const outside = path.join(fixture, "outside");
      const target = path.join(root, dir);
      const wrongTarget = dir === "-" ? outside : path.join(outside, dir);
      const originalCwd = process.cwd();
      const output: string[] = [];
      const spy = vi
        .spyOn(console, "log")
        .mockImplementation((value) => output.push(String(value)));
      try {
        mkdirSync(root);
        mkdirSync(wrongTarget, { recursive: true });
        process.chdir(root);
        await runInit({ adapter, dir });
        const config = parse(readFileSync(path.join(root, "specproof.config.yaml"), "utf8"));
        const manual = output.join("\n").match(/^  b\. (.*)$/m)?.[1];
        assert.ok(manual);
        const bin = path.join(fixture, "stub-bin");
        mkdirSync(bin);
        for (const name of ["npm", "flutter"]) {
          writeFileSync(
            path.join(bin, name),
            '#!/bin/sh\nprintf "executed\\n" > command-ran.txt\nprintf "%s\\n" "$PWD"\n',
            { mode: 0o755 },
          );
        }
        for (const command of [config.commands.install, manual]) {
          const result = spawnSync(
            "/bin/bash",
            ["-c", `OLDPWD="$SCAFFOLD_TEST_OLDPWD"\n${command}`],
            {
              cwd: root,
              encoding: "utf8",
              env: { PATH: bin, LC_ALL: "C", SCAFFOLD_TEST_OLDPWD: outside, CDPATH: outside },
              timeout: 10_000,
            },
          );
          assert.ifError(result.error);
          assert.equal(result.status, 0, result.stderr);
          assert.equal(existsSync(path.join(wrongTarget, "command-ran.txt")), false, result.stdout);
          assert.equal(existsSync(path.join(target, "command-ran.txt")), true);
          assert.ok(result.stdout.trim().length > 0);
          for (const cwd of result.stdout.trim().split("\n")) assert.equal(cwd, target);
        }
      } finally {
        spy.mockRestore();
        process.chdir(originalCwd);
        rmSync(fixture, { recursive: true, force: true });
      }
    }, 20_000);
  }
}

for (const control of ["\0", "\n", "\r", "\t", "\x1b", "\x7f"]) {
  test(`制御文字 ${JSON.stringify(control)} を含む配置先は書込前に拒否する`, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "specproof-control-path-"));
    try {
      assert.throws(
        () =>
          scaffoldTemplate({
            tplDir: path.join(templates, "playwright"),
            repoRoot: root,
            e2eDir: path.join(root, `tests${control}bdd`),
            templateDefaultDir: "packages/e2e",
            force: false,
          }),
        /control characters/,
      );
      assert.deepEqual(readdirSync(root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const adapter of ["playwright", "flutter"]) {
  test(`${adapter}: 手動の導入コマンドも配置先を一つの引数として扱う`, async () => {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "specproof-manual-path-")));
    const originalCwd = process.cwd();
    const output: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((value) => output.push(String(value)));
    try {
      process.chdir(root);
      const dir = "tests; touch injected-marker; #'画面";
      await runInit({ adapter, dir });
      const command = output.join("\n").match(/^  b\. (.*)$/m)?.[1];
      assert.ok(command);
      const bin = path.join(root, "stub-bin");
      mkdirSync(bin);
      for (const name of ["npm", "flutter"]) {
        writeFileSync(path.join(bin, name), '#!/bin/sh\nprintf "%s\\n" "$PWD"\n', { mode: 0o755 });
      }
      const result = spawnSync("/bin/bash", ["-c", command], {
        cwd: root,
        encoding: "utf8",
        env: { PATH: bin, LC_ALL: "C" },
        timeout: 5_000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.trim().length > 0);
      for (const cwd of result.stdout.trim().split("\n")) assert.equal(cwd, path.join(root, dir));
    } finally {
      spy.mockRestore();
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });
}
