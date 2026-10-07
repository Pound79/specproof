import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test, vi } from "vitest";
import type { RepoSnapshot } from "../detect.js";

// ファイルの読み取りだけを差し替え、判定と推奨の選択は本物の detect を使う。
const snapshot = vi.hoisted(() => ({ current: { rootFiles: [] } as RepoSnapshot }));
vi.mock("../detect.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../detect.js")>()),
  collectSnapshot: async () => snapshot.current,
}));

const { runDetect } = await import("../cli-detect.js");

let output: string[] = [];
beforeEach(() => {
  output = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    output.push(args.join(" "));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const run = async (current: RepoSnapshot, json = false): Promise<string> => {
  snapshot.current = current;
  await runDetect({ json });
  return output.join("\n");
};

describe("runDetect の表示", () => {
  test("候補が無ければ手動指定を案内する", async () => {
    const text = await run({ rootFiles: [] });
    assert.match(text, /No supported framework detected/);
    assert.match(text, /specproof init --adapter <playwright\|flutter>/);
  });

  test("--json は判定結果だけを JSON で出す", async () => {
    const text = await run(
      {
        rootFiles: ["package.json"],
        packageJson: { devDependencies: { "@playwright/test": "1" } },
      },
      true,
    );
    const parsed = JSON.parse(text);
    assert.equal(parsed.candidates[0].adapter, "playwright");
    assert.doesNotMatch(text, /Recommendation/);
  });

  test("候補が一つに定まれば推奨コマンドとシグナルを示す", async () => {
    const text = await run({
      rootFiles: ["pubspec.yaml"],
      pubspecYaml: { hasFlutterSdk: true },
    });
    assert.match(text, /flutter \(high\) -> bdd_tests/);
    assert.match(text, /signal: /);
    assert.match(text, /Recommendation: specproof init --adapter flutter --dir bdd_tests/);
  });

  test("monorepo と環境のヒントを表示する", async () => {
    const text = await run({
      rootFiles: ["package.json", "pnpm-workspace.yaml", ".env.example"],
      packageJson: { devDependencies: { "@playwright/test": "1" } },
      envExampleKeys: ["API_URL_LOCAL", "MOCK_AUTH", "API_URL_DEV", "GOOGLE_CLIENT_ID"],
    });
    assert.match(text, /Monorepo detected/);
    assert.match(text, /Environment hints/);
    assert.match(text, /local auth=mock/);
    assert.match(text, /dev auth=google/);
  });

  test("候補が競合すれば推奨せず明示指定を求める", async () => {
    const text = await run({
      rootFiles: ["package.json", "pubspec.yaml"],
      packageJson: { devDependencies: { "@playwright/test": "1" } },
      pubspecYaml: { hasFlutterSdk: true },
    });
    assert.match(text, /Detection is inconclusive/);
    assert.doesNotMatch(text, /Recommendation/);
  });
});
