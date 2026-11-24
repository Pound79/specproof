import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";

// 起動したディレクトリによらず、CI の GITHUB_WORKSPACE と同じリポジトリのルートを渡す。
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const workflow = parse(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"));
const steps = workflow.jobs["scaffold-e2e"].steps;

for (const key of ["generate", "typecheck"]) {
  test(`足場 CI が生成設定の commands.${key} を利用側ルートで実行する`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specproof-ci-"));
    try {
      const step = steps.find((item) => item.name?.includes(`commands.${key}`));
      assert.ok(step);
      writeFileSync(path.join(dir, "specproof.config.yaml"), stringify({ commands: { [key]: "exit 42" } }));
      const result = spawnSync("bash", ["-e", "-c", step.run], {
        cwd: dir, encoding: "utf8", env: { ...process.env, GITHUB_WORKSPACE: repoRoot },
      });
      assert.ifError(result.error);
      assert.equal(result.status, 42, result.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
