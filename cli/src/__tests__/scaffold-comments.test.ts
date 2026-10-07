import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { parse } from "yaml";
import { rewriteScaffoldConfig } from "../scaffold-config.js";

const templates = fileURLToPath(new URL("../../../templates/", import.meta.url));
const adapters = [
  { adapter: "playwright", defaultDir: "packages/e2e" },
  { adapter: "flutter", defaultDir: "bdd_tests" },
] as const;

const DIVIDER = /^\s*# -{20,}\s*$/;
const ADDITIONAL_ENVIRONMENTS = "# TODO: uncomment and configure additional environments as needed";

/** 追加環境の例を、テンプレートの TODO が指示するとおりにコメント解除する。 */
const uncommentAdditionalEnvironments = (source: string): string => {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.trim() === ADDITIONAL_ENVIRONMENTS);
  assert.ok(start >= 0, "追加環境の TODO が見つからない");
  const uncommented = lines.map((line, index) => {
    if (index <= start) return line;
    const block = lines.slice(start + 1, index + 1);
    return block.every((entry) => /^\s*#/.test(entry)) ? line.replace(/^(\s*)# ?/, "$1") : line;
  });
  return uncommented.join("\n");
};

/** environments ブロック（次のトップレベルキーまで）の行。 */
const environmentLines = (source: string): string[] => {
  const lines = source.split("\n");
  const start = lines.indexOf("environments:");
  assert.ok(start >= 0, "environments が見つからない");
  const end = lines.findIndex((line, index) => index > start && /^[A-Za-z]/.test(line));
  return lines.slice(start, end === -1 ? undefined : end);
};

const assertCommentLayout = (source: string, label: string): void => {
  const misplaced = source
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => DIVIDER.test(line) && !line.startsWith("#"));
  assert.deepEqual(misplaced, [], `${label}: 節の区切りコメントは列 0 に置く`);

  const environments = parse(uncommentAdditionalEnvironments(source)).environments;
  assert.deepEqual(
    environments.map((entry: { name: string }) => entry.name),
    ["local", "dev"],
    `${label}: 追加環境の例はコメント解除だけで有効な 2 件目になる`,
  );

  const duplicateAuth = environmentLines(source).filter((line) => /^ {4}#\s*auth:\s*$/.test(line));
  assert.deepEqual(duplicateAuth, [], `${label}: 既存の auth と重複するコメント例を置かない`);
};

describe.each(adapters)("$adapter テンプレートのコメント配置", ({ adapter, defaultDir }) => {
  const source = readFileSync(`${templates}${adapter}/specproof.config.yaml`, "utf8");

  test("テンプレート本体のコメントがそのまま使える位置にある", () => {
    assertCommentLayout(source, `${adapter} template`);
  });

  test("配置先を書き換えた生成物もコメント位置を保つ", () => {
    assertCommentLayout(
      rewriteScaffoldConfig(source, defaultDir, "apps/e2e"),
      `${adapter} scaffold`,
    );
  });

  test("書き換えるのは配置先を含む値の行だけで、他の行は元テキストのまま", () => {
    const rewritten = rewriteScaffoldConfig(source, defaultDir, "apps/e2e");
    const before = source.split("\n");
    const after = rewritten.split("\n");
    assert.equal(after.length, before.length);
    const changed = after.filter((line, index) => line !== before[index]);
    assert.ok(changed.length > 0);
    for (const line of changed) assert.match(line, /apps\/e2e/, line);
  });
});
