import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import {
  loadSpecproofConfig,
  resolveActiveEnvironment,
} from "../templates/playwright/src/config/specproof-config.ts";

// 0.4.0 で、改名（bdd-kit → specproof、0.2.0）前の設定ファイル名と BDD_KIT_ENV を読むのをやめた。
// 黙って無視すると、置いた設定や選んだ環境が効かないままテストが走るので、名前の変更を案内して止める。
const templateConfig = () =>
  parse(readFileSync(new URL("../templates/playwright/specproof.config.yaml", import.meta.url), "utf8"));

for (const legacy of ["bdd-kit.config.yaml", "bdd-kit.config.yml"]) {
  test(`雛形は ${legacy} だけがあれば名前の変更を案内して止まる`, () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "specproof-removed-config-"));
    try {
      writeFileSync(path.join(dir, legacy), "adapter: playwright\n");
      assert.throws(
        () => loadSpecproofConfig(dir),
        new RegExp(`${legacy.replaceAll(".", "\\.")} is no longer read; rename it to specproof\\.config\\.yaml`),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

const withEnv = (env, run) => {
  const saved = { SPECPROOF_ENV: process.env.SPECPROOF_ENV, BDD_KIT_ENV: process.env.BDD_KIT_ENV };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test("雛形は BDD_KIT_ENV だけが設定されていれば SPECPROOF_ENV を案内して止まる", () => {
  const config = templateConfig();
  const name = config.environments[0].name;
  withEnv({ SPECPROOF_ENV: undefined, BDD_KIT_ENV: name }, () => {
    assert.throws(() => resolveActiveEnvironment(config), /BDD_KIT_ENV is no longer read; use SPECPROOF_ENV/);
  });
});

test("雛形は SPECPROOF_ENV があればそれを使い、残った BDD_KIT_ENV では止まらない", () => {
  const config = templateConfig();
  const name = config.environments[0].name;
  withEnv({ SPECPROOF_ENV: name, BDD_KIT_ENV: "anything" }, () => {
    assert.equal(resolveActiveEnvironment(config).name, name);
  });
});
