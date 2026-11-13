import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../../dist/cli-check.js", import.meta.url));

// implGlobs が広いと unregistered-impl が上限（20 件）を超える。省略の行は、省いた
// 種類と件数、全件の見方を示し、--json は今どおり全件を返す。
describe("specproof-check の省略表示", () => {
  const IMPL_FILES = 25;
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "specproof-hidden-"));
    mkdirSync(path.join(root, "src"));
    for (let i = 0; i < IMPL_FILES; i += 1) {
      writeFileSync(path.join(root, "src", `orphan-${i}.ts`), `export const x${i} = ${i};\n`);
    }
    writeFileSync(
      path.join(root, "specproof.config.yaml"),
      'layout:\n  implGlobs:\n    - "src/**/*.ts"\n',
    );
    writeFileSync(path.join(root, "traceability.yaml"), "version: 1\nlinks: []\n");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const run = (...args: string[]) => {
    const { SPECPROOF_DEBUG: _ignored, ...env } = process.env;
    const result = spawnSync(process.execPath, [cli, "--root", root, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      env,
    });
    expect(result.error).toBeUndefined();
    return result;
  };

  it("テキスト出力は省いた種類・件数・--json の案内を 1 行で出す", () => {
    const result = run();

    expect(result.status).toBe(0);
    const unregistered = result.stdout
      .split("\n")
      .filter((line) => line.includes("implementation file is not registered"));
    expect(unregistered).toHaveLength(20);
    expect(result.stdout).toContain(
      "...and 5 more unregistered-impl (shown 20 of 25; run with --json for the full list)",
    );
    expect(result.stdout).not.toMatch(/^\.\.\.and \d+ more$/m);
  });

  it("--json の warnings は省かず全件を返す", () => {
    const result = run("--json");

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as { warnings: { kind: string }[] };
    const impl = report.warnings.filter((warning) => warning.kind === "unregistered-impl");
    expect(impl).toHaveLength(IMPL_FILES);
    expect(result.stdout).not.toContain("more unregistered-impl");
  });
});
