import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { parse } from "yaml";

const repo = fileURLToPath(new URL("../", import.meta.url));
let temp;
let tarball;
let yamlTarball;
const run = (command, args, cwd, env = process.env) => {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 120_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${command}: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
};
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const offline = (cache) => ({
  ...process.env,
  npm_config_cache: cache,
  npm_config_offline: "true",
  npm_config_audit: "false",
  npm_config_fund: "false",
  npm_config_ignore_scripts: "true",
});

before(() => {
  temp = mkdtempSync(path.join(os.tmpdir(), "specproof-packed-consumer-"));
  const env = offline(path.join(temp, "pack-cache"));
  const pack = (args) => {
    const packed = JSON.parse(run("npm", ["pack", ...args, "--json", "--ignore-scripts", "--pack-destination", temp], repo, env));
    return path.join(temp, packed[0].filename);
  };
  tarball = pack(["--workspace", "@pound79/specproof-traceability"]);
  // npm ci は tarball だけをキャッシュし、範囲解決用 metadata を残さない場合がある。
  // 実際に lock から導入済みの runtime 依存も pack し、外部キャッシュに依存させない。
  const engine = JSON.parse(readFileSync(path.join(repo, "packages/traceability/package.json"), "utf8"));
  assert.deepEqual(Object.keys(engine.dependencies), ["yaml"]);
  const installed = JSON.parse(readFileSync(path.join(repo, "node_modules/yaml/package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(path.join(repo, "package-lock.json"), "utf8"));
  assert.equal(installed.version, lock.packages["node_modules/yaml"].version);
  assert.deepEqual(Object.keys(installed.dependencies ?? {}), []);
  yamlTarball = pack([path.join(repo, "node_modules/yaml")]);
});
after(() => { if (temp) rmSync(temp, { recursive: true, force: true }); });

for (const [adapter, defaultDir] of [["playwright", "packages/e2e"], ["flutter", "bdd_tests"]]) {
  for (const [index, dir] of [".", defaultDir, "custom-bdd"].entries()) {
    test(`${adapter}/${dir}: 生成した全 traceability コマンドが未公開 tarball で動く`, { timeout: 180_000 }, () => {
      const consumer = path.join(temp, `${adapter}-${index}`);
      mkdirSync(consumer);
      run(process.execPath, [path.join(repo, "cli/dist/index.js"), "init", "--adapter", adapter, "--dir", dir], consumer);
      const config = parse(readFileSync(path.join(consumer, "specproof.config.yaml"), "utf8"));
      const version = JSON.parse(readFileSync(path.join(repo, "packages/traceability/package.json"), "utf8")).version;
      const expectedPin = `@pound79/specproof-traceability@${version}`;
      // 各配置で新しい空キャッシュを使い、他のテストの npm install に依存させない。
      const env = offline(path.join(temp, `cache-${adapter}-${index}`));
      for (const key of ["traceabilityCheck", "traceabilityList", "traceabilityStats", "traceabilityUpdate"]) {
        assert.ok(config.commands[key].includes(expectedPin), key);
        // engine と lock 済み runtime 依存の package spec だけを実 tarball に置換する。
        // CLI 名・引数・cwd は生成コマンドのまま。registry への通信は禁止する。
        const command = config.commands[key].replace(expectedPin, `${quote(yamlTarball)} -p ${quote(tarball)}`);
        run("bash", ["-c", command], consumer, env);
      }
    });
  }
}
