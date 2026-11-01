import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectSnapshot, detectAdapter } from "../detect.js";

// detect と init --adapter auto が読む package.json は、実行したディレクトリの信頼できない入力。
// JSON として読めても形が違うフィールドは無いものとして扱い、例外で止めず、誤った候補も出さない。
const snapshotOf = async (packageJson: string) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "specproof-detect-shape-"));
  try {
    writeFileSync(path.join(dir, "package.json"), packageJson);
    return await collectSnapshot(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("package.json の形の検証", () => {
  it.each(["null", "[]", '"text"', "1", "true"])(
    "トップレベルが %s でも止まらず、package.json があることだけを使う",
    async (text) => {
      const snapshot = await snapshotOf(text);
      expect(snapshot.packageJson).toEqual({});
      const [candidate] = detectAdapter(snapshot).candidates;
      expect(candidate).toMatchObject({ adapter: "playwright", confidence: "low" });
    },
  );

  it.each([
    ["文字列でない値を含む", { react: 1 }],
    ["配列", ["react"]],
    ["文字列", "react"],
    ["入れ子の object", { react: { version: "1" } }],
  ])("dependencies が%sなら無視する", async (_label, dependencies) => {
    const snapshot = await snapshotOf(JSON.stringify({ dependencies }));
    expect(snapshot.packageJson?.dependencies).toBeUndefined();
    expect(detectAdapter(snapshot).candidates[0]).toMatchObject({ confidence: "low" });
  });

  it("devDependencies の形が違えば無視し、dependencies は使う", async () => {
    const snapshot = await snapshotOf(
      JSON.stringify({
        dependencies: { react: "^18" },
        devDependencies: { "@playwright/test": 1 },
      }),
    );
    expect(snapshot.packageJson).toEqual({ dependencies: { react: "^18" } });
    expect(detectAdapter(snapshot).candidates[0]).toMatchObject({ confidence: "medium" });
  });

  it("JSON の __proto__ キーを含む dependencies は無視し、プロトタイプを変えない", async () => {
    const snapshot = await snapshotOf('{"dependencies":{"__proto__":{"react":"1"}}}');
    expect(snapshot.packageJson?.dependencies).toBeUndefined();
    expect(detectAdapter(snapshot).candidates[0]).toMatchObject({ confidence: "low" });
  });

  it.each([
    ["数値の配列", [1]],
    ["packages が文字列", { packages: "packages/*" }],
    ["packages が数値の配列", { packages: [1] }],
    ["文字列", "packages/*"],
    ["null", null],
  ])("workspaces が%sなら無視する", async (_label, workspaces) => {
    const snapshot = await snapshotOf(JSON.stringify({ workspaces }));
    expect(snapshot.packageJson?.workspaces).toBeUndefined();
    expect(detectAdapter(snapshot).hints.monorepo).toBe(false);
  });

  it.each([
    ["文字列の配列", ["packages/*"], ["packages/*"]],
    [
      "packages を持つ object",
      { packages: ["packages/*"], nohoist: ["x"] },
      { packages: ["packages/*"] },
    ],
  ])("workspaces が%sなら使う", async (_label, workspaces, expected) => {
    const snapshot = await snapshotOf(JSON.stringify({ workspaces }));
    expect(snapshot.packageJson?.workspaces).toEqual(expected);
    expect(detectAdapter(snapshot).hints.monorepo).toBe(true);
  });
});
