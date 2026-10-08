import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";

// implGlobs は PR で変更できる設定なので、照合の計算量がパターンで爆発すると CI を止められる。
// 実際の利用経路（findImplCandidates）を別プロセスで呼び、制限時間内に終わることを確かめる。
const implAudit = fileURLToPath(new URL("../../dist/impl-audit.js", import.meta.url));

const runWithTimeout = (pattern: string, fileName: string) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "glob-complexity-"));
  try {
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src", fileName), "export {};\n");
    const script = `
      const { findImplCandidates } = await import(${JSON.stringify(implAudit)});
      const found = await findImplCandidates(${JSON.stringify(root)}, [${JSON.stringify(pattern)}]);
      process.stdout.write(JSON.stringify(found));
    `;
    return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      timeout: 5_000,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe("implGlobs の照合は計算量が爆発しない", () => {
  test("ワイルドカードの繰り返しと末尾の不一致でも制限時間内に終わる", () => {
    const pattern = `src/${"*a".repeat(30)}b.ts`;
    const result = runWithTimeout(pattern, `${"a".repeat(60)}c.ts`);
    assert.equal(result.error, undefined, "照合が制限時間内に終わらなかった");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), []);
  });

  test("同じ形のパターンでも一致するファイルは見つける", () => {
    const pattern = `src/${"*a".repeat(30)}b.ts`;
    const result = runWithTimeout(pattern, `${"a".repeat(60)}b.ts`);
    assert.equal(result.error, undefined);
    assert.deepEqual(JSON.parse(result.stdout), [`src/${"a".repeat(60)}b.ts`]);
  });
});
