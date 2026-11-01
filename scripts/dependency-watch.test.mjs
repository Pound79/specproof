import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

// SECURITY.md は、依存の脆弱性を期限内に直すと約束している。Dependabot が見ていない依存は
// 期限を守る仕組みが無いので、監視の範囲をテストで固定する。
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const exists = (file) => existsSync(new URL(`../${file}`, import.meta.url));
const updates = parse(read(".github/dependabot.yml")).updates;

test("Flutter の雛形の pub の依存を Dependabot が見る", () => {
  const entry = updates.find(
    (u) => u["package-ecosystem"] === "pub" && u.directory === "/templates/flutter",
  );
  assert.ok(entry, "add a pub entry for /templates/flutter");
  assert.ok(exists("templates/flutter/pubspec.yaml"));
  assert.ok(entry.cooldown?.["default-days"] >= 7);
});

// Dependabot の github-actions は .github/workflows/ しか見ない。雛形のワークフローの actions は、
// specproof 自身のワークフローと同じ SHA に固定して、Dependabot の更新に追従させる。
// 雛形だけで使う action は自動で追えないので、ここに挙げて手で追う。
const TEMPLATE_ONLY_ACTIONS = ["actions/github-script"];
// uses: の行はすべて「owner/repo@40 桁の SHA」でなければならない。タグやサブパスの指定は
// 照合から黙って漏れる（検査が緑のまま）ので、形が違えば失敗させる。
const PINNED = /^\s*-?\s*uses:\s*([\w.-]+\/[\w.-]+)@([0-9a-f]{40})(?:\s+#.*)?$/;
const pins = (dir) => {
  const found = new Map();
  for (const name of readdirSync(new URL(`../${dir}`, import.meta.url))) {
    for (const line of read(`${dir}/${name}`).split("\n")) {
      if (!/^\s*-?\s*uses:/.test(line)) continue;
      const match = PINNED.exec(line);
      assert.ok(match, `${dir}/${name}: not pinned to owner/repo@<sha>: ${line.trim()}`);
      const [, action, sha] = match;
      found.set(action, [...new Set([...(found.get(action) ?? []), sha])]);
    }
  }
  return found;
};

test("自身のワークフローは同じ action を 1 つの SHA に固定する", () => {
  for (const [action, shas] of pins(".github/workflows")) {
    assert.equal(shas.length, 1, `${action} is pinned to several SHAs: ${shas.join(", ")}`);
  }
});

test("pub の意図した固定を Dependabot が崩さない", () => {
  const entry = updates.find((u) => u["package-ecosystem"] === "pub");
  const ignored = new Map(entry.ignore.map((rule) => [rule["dependency-name"], rule["update-types"]]));
  assert.equal(ignored.get("flutter_gherkin"), undefined, "flutter_gherkin: ignore every update");
  assert.ok(ignored.has("flutter_gherkin"));
  assert.deepEqual(ignored.get("build_runner"), [
    "version-update:semver-major",
    "version-update:semver-minor",
  ]);
});

test("雛形のワークフローの actions は自身のワークフローと同じ SHA か、手で追うものとして挙げる", () => {
  const own = pins(".github/workflows");
  for (const adapter of ["playwright", "flutter"]) {
    for (const [action, shas] of pins(`templates/${adapter}/github-workflows`)) {
      if (TEMPLATE_ONLY_ACTIONS.includes(action)) {
        assert.ok(!own.has(action), `${action} is now in .github/workflows; drop it from the list`);
        continue;
      }
      assert.ok(own.has(action), `${adapter}: ${action} is not tracked by Dependabot`);
      for (const sha of shas) {
        assert.ok(own.get(action).includes(sha), `${adapter}: ${action}@${sha} differs from .github/workflows`);
      }
    }
  }
});
