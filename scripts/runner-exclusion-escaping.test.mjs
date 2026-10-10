import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const configModule = new URL(
  "../templates/playwright/src/config/specproof-config.ts",
  import.meta.url,
).href;

const resolveWithProjectTags = (tags) =>
  spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
        const { resolveActiveEnvironment } = await import(${JSON.stringify(configModule)});
        resolveActiveEnvironment({
          projects: [{ name: "p", tags: ${JSON.stringify(tags)} }],
          environments: [{ name: "local", default: true }],
        });
      `,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, SPECPROOF_ENV: "local", BDD_KIT_ENV: "" },
      timeout: 10_000,
    },
  );

test("タグ式のエスケープで固定の実行除外を抜ける入力を拒否する", () => {
  for (const tags of [
    String.raw`@x\( or @admin) or (@y\)`,
    String.raw`@x\( or @admin) or (@y\) or (@z)`,
    // Cucumber は復号後の単独の括弧も演算子として読む。
    String.raw`@admin \) or \( @never`,
    String.raw`@admin \) or ( @never \) or \( @last`,
    "@admin\\",
    String.raw`@admin\q`,
    String.raw`@admin\(x)`,
  ]) {
    const result = resolveWithProjectTags(tags);
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, tags);
    assert.match(result.stderr, /projects.*unbalanced parentheses or invalid escaping/, tags);
  }
});

test("タグ名のリテラルの括弧やバックスラッシュは引き続き使える", () => {
  for (const tags of [
    String.raw`@issue\(open\)`,
    String.raw`@literal\(`,
    String.raw`@literal\)`,
    String.raw`@name\\path`,
    String.raw`(@issue\(open\) or @admin) and not @slow`,
    "@human-resources",
    "@red-contract-test",
  ]) {
    const result = resolveWithProjectTags(tags);
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${tags}: ${result.stderr}`);
  }
});
