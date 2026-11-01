import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

// specproof-check は設定ファイルが無ければ既定値で動き、featuresDir の警告も出さない
// （設定を置かない engine 単体の利用のため）。init が配るワークフローでは設定ファイルは
// 必ずあるはずなので、PR で消されたら --strict が登録していない feature を見ないまま
// 通らないよう、検査の前に止める。

// src/__tests__/drift-check-config-required.test.ts -> repo root is four levels up.
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../..");
const STEP_NAME = "Require the specproof config";

type Step = {
  name?: string;
  run?: string;
  shell?: string;
  if?: string;
  "continue-on-error"?: unknown;
};
type Workflow = { jobs: Record<string, { steps?: Step[] }> };

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const workspace = (files: string[]): string => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "drift-config-"));
  created.push(dir);
  for (const file of files) writeFileSync(path.join(dir, file), "layout: {}\n");
  return dir;
};

for (const adapter of ["playwright", "flutter"]) {
  const file = `templates/${adapter}/github-workflows/specproof-drift-check.yml`;
  const steps =
    (parse(readFileSync(path.join(repoRoot, file), "utf8")) as Workflow).jobs["drift-check"]
      ?.steps ?? [];
  const step = steps.find((candidate) => candidate.name === STEP_NAME);

  const runStep = (dir: string) =>
    spawnSync("bash", ["-e", "-c", step?.run ?? "exit 99"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, GITHUB_WORKSPACE: dir },
    });

  describe(`${file} の設定ファイルの確認`, () => {
    it("specproof-check より前に設定ファイルを確かめる", () => {
      const names = steps.map((candidate) => candidate.name);
      expect(names).toContain(STEP_NAME);
      expect(names.indexOf(STEP_NAME)).toBeLessThan(names.indexOf("Run specproof-check"));
    });

    // 条件や continue-on-error が付くと、run が正しくてもゲートとして働かない。
    it("条件・失敗の無視・別のシェルを付けない", () => {
      expect(step?.if).toBeUndefined();
      expect(step?.["continue-on-error"]).toBeUndefined();
      expect(step?.shell).toBeUndefined();
    });

    it("設定ファイルが無ければ、理由を出して止まる", () => {
      const result = runStep(workspace(["traceability.yaml"]));
      expect(result.status).not.toBe(0);
      expect(result.stdout).toMatch(/^::error::.*specproof\.config\.yaml/m);
    });

    it("リンク切れの symlink は止めずに specproof-check へ渡す（そこで理由付きで止まる）", () => {
      const dir = workspace(["traceability.yaml"]);
      symlinkSync(path.join(dir, "nowhere.yaml"), path.join(dir, "specproof.config.yaml"));
      expect(runStep(dir).status).toBe(0);
    });

    for (const name of ["specproof.config.yaml", "specproof.config.yml"]) {
      it(`${name} があれば先へ進む`, () => {
        const result = runStep(workspace([name, "traceability.yaml"]));
        expect(result.status, result.stdout + result.stderr).toBe(0);
      });
    }
  });
}
