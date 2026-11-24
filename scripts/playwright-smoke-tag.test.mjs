import assert from "node:assert/strict";
import { test } from "node:test";
import * as config from "../templates/playwright/src/config/specproof-config.ts";

test("smoke だけが設定で指定したタグを Gherkin 式で除外する", () => {
  const projects = [{ name: "guest", tags: "not @admin" }];
  const env = { name: "local", excludeTags: ["@remote"] };
  const cfg = { tags: { slow: "@長時間" }, projects, environments: [env] };
  assert.deepEqual(config.runnerExclusions(cfg, env, false), ["@remote"]);
  assert.deepEqual(config.runnerExclusions(cfg, env, true), ["@remote", "@長時間"]);
  for (const slow of ["@red-contract", "@first or @second", "@unfinished\\"]) {
    assert.throws(() => config.runnerExclusions({ ...cfg, tags: { slow } }, env, true), /tags.slow/);
  }
});
