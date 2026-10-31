import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkDrift } from "../check.js";
import { computeFileHash } from "../hash.js";

const CONTENT = "Feature: 表示\n  Scenario: 開く\n    When 一覧を開く\n    Then 一覧が表示される\n";

const withAliases = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "feature-identity-"));
  try {
    await mkdir(path.join(root, "features"));
    await writeFile(path.join(root, "features/a.feature"), CONTENT);
    await symlink("a.feature", path.join(root, "features/alias.feature"));
    const hash = await computeFileHash(path.join(root, "features/a.feature"));
    await writeFile(
      path.join(root, "traceability.yaml"),
      JSON.stringify({
        version: 1,
        links: ["a.feature", "alias.feature"].map((name, index) => ({
          id: `link-${index}`,
          label: `条件 ${index}`,
          spec: [],
          impl: [],
          features: [{ path: `features/${name}`, hash }],
        })),
      }),
    );
    await run(root);
  } finally {
    await rename(root, `${root}-retained`);
  }
};

const cli = (root: string, command: "check" | "stats", ...flags: string[]) =>
  spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL(`../cli-${command}.ts`, import.meta.url)),
      "--root",
      root,
      ...flags,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );

describe.skipIf(process.platform === "win32")("登録した feature の実体", () => {
  it.each([undefined, "features"])(
    "featuresDir=%s でも別名登録を strict の重複警告にしない",
    async (featuresDir) =>
      withAliases(async (root) => {
        await writeFile(
          path.join(root, "specproof.config.yaml"),
          `strictFeatureLint: true\n${featuresDir ? "layout:\n  featuresDir: features\n" : ""}`,
        );
        const report = await checkDrift(path.join(root, "traceability.yaml"), root, {
          featuresDir,
        });
        expect(report.clean).toBe(true);
        expect(report.warnings).toEqual([]);
        const result = cli(root, "check", "--strict", "--json");
        expect(result.error).toBeUndefined();
        // 設定ファイルに featuresDir が無いことだけを知らせ（strict で失敗）、別名は重複にしない。
        const kinds = JSON.parse(result.stdout).warnings.map((w: { kind: string }) => w.kind);
        expect(kinds).toEqual(featuresDir ? [] : ["features-dir-unset"]);
        expect(result.status, result.stderr).toBe(featuresDir ? 0 : 1);
      }),
  );

  it("featuresDir 未指定でも別名登録した条件とケースを一度だけ数える", async () =>
    withAliases(async (root) => {
      const result = cli(root, "stats", "--strict", "--json");
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.totals.total).toBe(1);
      expect(report.totals.cases).toBe(1);
      expect(report.domains.map((domain: { domain: string }) => domain.domain)).toEqual([
        "features/a.feature",
      ]);
    }));

  it("別名ごとに保存した hash はそれぞれ検査する", async () =>
    withAliases(async (root) => {
      const manifestPath = path.join(root, "traceability.yaml");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.links[1].features[0].hash = "PENDING";
      await writeFile(manifestPath, JSON.stringify(manifest));
      const report = await checkDrift(manifestPath, root);
      expect(report.clean).toBe(false);
      expect(report.entries).toEqual([
        expect.objectContaining({ linkId: "link-1", path: "features/alias.feature" }),
      ]);
      expect(report.warnings).toEqual([]);
    }));

  it("本文が同じでも異なる実体の feature は重複条件として検出する", async () =>
    withAliases(async (root) => {
      await writeFile(path.join(root, "features/copy.feature"), CONTENT);
      const manifestPath = path.join(root, "traceability.yaml");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.links[1].features[0].path = "features/copy.feature";
      await writeFile(manifestPath, JSON.stringify(manifest));
      const report = await checkDrift(manifestPath, root);
      expect(report.warnings).toEqual([
        expect.objectContaining({ kind: "duplicate-scenario", path: "features/copy.feature" }),
      ]);
    }));

  it("別名登録した実装待ちは一度だけ数え、strict を失敗させる", async () =>
    withAliases(async (root) => {
      await writeFile(path.join(root, "features/a.feature"), `@red-contract\n${CONTENT}`);
      const result = cli(root, "stats", "--strict", "--json");
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.totals.phase.pending).toBe(1);
      expect(report.done).toBe(false);
    }));
});
