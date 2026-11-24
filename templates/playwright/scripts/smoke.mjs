// `npm run test:smoke` の入口。bddgen と playwright test の両方に SPECPROOF_SMOKE=1 を渡し、
// playwright.config.ts が設定の tags.slow を除外するようにする。
// `VAR=1 cmd` は Windows の cmd.exe で動かず、cross-env などの依存も増やさないため、Node から起動する。
// .bin のシム（Windows では .cmd）を経由せず、各 package の bin の JS を今の node で直接実行する。
// 追加の引数（`npm run test:smoke -- --project guest` など）は playwright test にだけ渡す。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

function binEntry(packageName, binName) {
  const manifestPath = require.resolve(`${packageName}/package.json`);
  const { bin } = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry = typeof bin === "string" ? bin : bin?.[binName];
  if (typeof entry !== "string") {
    throw new Error(`specproof: ${packageName} does not provide the ${binName} command.`);
  }
  return path.join(path.dirname(manifestPath), entry);
}

function run(packageName, binName, args) {
  const result = spawnSync(process.execPath, [binEntry(packageName, binName), ...args], {
    stdio: "inherit",
    env: { ...process.env, SPECPROOF_SMOKE: "1" },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const generated = run("playwright-bdd", "bddgen", []);
process.exitCode =
  generated !== 0 ? generated : run("@playwright/test", "playwright", ["test", ...process.argv.slice(2)]);
