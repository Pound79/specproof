import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import YAML from "yaml";

// 利用者は drift-check などで `npx -p @pound79/specproof-traceability@<版>` を lockfile 無しで
// 動かす。実行時の依存を範囲で書くと、取得のたびに新しい版（乗っ取られた版を含む）が入りうる。
// 完全な版で固定し、その依存自身も依存を持たないことで、推移的な依存まで版を固定する。
const read = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const EXACT = /^\d+\.\d+\.\d+$/;

for (const file of ["cli/package.json", "packages/traceability/package.json"]) {
  test(`${file}: 実行時の依存は完全な版で固定し、その依存は依存を持たない`, () => {
    const manifest = read(file);
    for (const field of ["optionalDependencies", "peerDependencies", "bundleDependencies", "bundledDependencies"]) {
      assert.equal(manifest[field], undefined, `${file}: ${field} would not be pinned by this check`);
    }
    const { dependencies = {} } = manifest;
    for (const [name, version] of Object.entries(dependencies)) {
      assert.match(version, EXACT, `${file}: ${name} must be pinned to an exact version`);
      const installed = read(`node_modules/${name}/package.json`);
      assert.equal(installed.version, version, `${name}: lockfile must resolve the pinned version`);
      for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
        assert.deepEqual(
          Object.keys(installed[field] ?? {}),
          [],
          `${name} has ${field}; pinning it does not pin them`,
        );
      }
    }
  });
}

test("Dependabot は固定した版を範囲に広げずに上げる", () => {
  const { parse } = YAML;
  const root = parse(readFileSync(new URL("../.github/dependabot.yml", import.meta.url), "utf8")).updates.find(
    (u) => u["package-ecosystem"] === "npm" && u.directory === "/",
  );
  assert.equal(root["versioning-strategy"], "increase");
});
