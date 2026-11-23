import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("sync は、写した仕様の取り込み元を確かめてから clean で終了するかを決める", () => {
  // 取り込み元だけが進み、利用側の仕様・実装・feature が変わっていないとき、check は clean になる。
  // clean で先に終了すると、取り込み漏れに気づかない。
  for (const file of [
    "plugins/specproof/skills/specproof-sync/SKILL.md",
    ".agents/skills/specproof-sync/SKILL.md",
  ]) {
    const skill = read(file);
    const from = skill.indexOf("### 1. Drift の特定");
    const step = skill.slice(from, skill.indexOf("### 2.", from));
    const sources = step.indexOf("--spec-sources --json");
    const clean = step.indexOf("clean なら「同期不要」と報告して終了");
    assert.ok(sources >= 0 && clean >= 0, file);
    assert.ok(sources < clean, `${file}: 取り込み元の確かめが clean の判定より後にある`);
    // 取り込んだら check を流し直してから進む。
    assert.match(step, /取り込んだら[^。]*`entries`[^。]*取り直/);
    // 取り込み元を確かめられなかったときは、古いかを判断できないので clean で終了せず人に返す。
    assert.match(step, /`spec-source-unresolved`（[^）]*）があれば[^。]*clean での終了もせず[^。]*人に返す/);
  }
});
