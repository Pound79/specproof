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
const run = (command, args, cwd, env = process.env) => {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 120_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${command}: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
};
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

before(() => {
  temp = mkdtempSync(path.join(os.tmpdir(), "specproof-packed-consumer-"));
  const packed = JSON.parse(run("npm", ["pack", "--workspace", "@pound79/specproof-traceability", "--json", "--ignore-scripts", "--pack-destination", temp], repo));
  tarball = path.join(temp, packed[0].filename);
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
      for (const key of ["traceabilityCheck", "traceabilityList", "traceabilityStats", "traceabilityUpdate"]) {
        assert.ok(config.commands[key].includes(expectedPin), key);
        // 公開前にも検証可能にするため、package spec だけを同版の実 tarball へ置換する。
        // それ以外は生成されたコマンドをそのまま実行し、registry への通信は禁止する。
        const command = config.commands[key].replace(expectedPin, quote(tarball));
        run("bash", ["-c", command], consumer, { ...process.env, npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_ignore_scripts: "true" });
      }
    });
  }
}
