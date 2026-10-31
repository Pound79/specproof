import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rename, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkDrift } from "../check.js";
import { computeFileHash } from "../hash.js";

// 登録済み対象の最初の検査ではなく、探索後の実体照合だけを故障させる。
const fault = vi.hoisted(() => ({
  afterScan: false,
  target: "",
  remaining: 0,
  error: undefined as NodeJS.ErrnoException | undefined,
}));
vi.mock("../feature-files.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../feature-files.js")>();
  return {
    ...actual,
    findFeatureFiles: async (...args: Parameters<typeof actual.findFeatureFiles>) => {
      const result = await actual.findFeatureFiles(...args);
      fault.afterScan = true;
      return result;
    },
  };
});
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    realpathSync: Object.assign(
      (...args: Parameters<typeof actual.realpathSync>) => {
        if (fault.error && fault.afterScan && args[0] === fault.target && --fault.remaining === 0) {
          throw fault.error;
        }
        return actual.realpathSync(...args);
      },
      { native: actual.realpathSync.native },
    ),
  };
});
afterEach(() => {
  fault.afterScan = false;
  fault.error = undefined;
});

const CONTENT = "Feature: 表示\n  Scenario: 開く\n    When 一覧を開く\n    Then 一覧が表示される\n";
const withAliasOnly = async (
  featuresDir: string | undefined,
  content: string,
  run: (root: string) => Promise<void>,
): Promise<void> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "feature-alias-only-"));
  try {
    await mkdir(path.join(root, "features"));
    await writeFile(path.join(root, "features/a.feature"), content);
    await symlink("a.feature", path.join(root, "features/alias.feature"));
    const hash = await computeFileHash(path.join(root, "features/a.feature"));
    await writeFile(
      path.join(root, "traceability.yaml"),
      JSON.stringify({
        version: 1,
        links: [
          {
            id: "alias-link",
            label: "表示",
            spec: [],
            impl: [],
            features: [{ path: "features/alias.feature", hash }],
          },
        ],
      }),
    );
    await writeFile(
      path.join(root, "specproof.config.yaml"),
      `strictFeatureLint: true\n${featuresDir ? "layout:\n  featuresDir: features\n" : ""}`,
    );
    await run(root);
  } finally {
    await rename(root, `${root}-retained`);
  }
};
const cli = (root: string, command: "check" | "stats") => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL(`../cli-${command}.ts`, import.meta.url)),
      "--root",
      root,
      "--strict",
      "--json",
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  expect(result.error).toBeUndefined();
  return result;
};

describe.skipIf(process.platform === "win32")("別名だけを登録した feature", () => {
  it.each([undefined, "features"])(
    "featuresDir=%s でも未登録・重複にせず strict を通す",
    async (featuresDir) =>
      withAliasOnly(featuresDir, CONTENT, async (root) => {
        const report = await checkDrift(path.join(root, "traceability.yaml"), root, {
          featuresDir,
        });
        expect(report.clean).toBe(true);
        expect(report.warnings).toEqual([]);
        const checked = cli(root, "check");
        // 設定ファイルに featuresDir が無いことだけを知らせ（strict で失敗）、別名は未登録・重複にしない。
        const kinds = JSON.parse(checked.stdout).warnings.map((w: { kind: string }) => w.kind);
        expect(kinds).toEqual(featuresDir ? [] : ["features-dir-unset"]);
        expect(checked.status, checked.stderr).toBe(featuresDir ? 0 : 1);
        const counted = cli(root, "stats");
        expect(counted.status, counted.stderr).toBe(0);
        const census = JSON.parse(counted.stdout);
        expect(census.totals.total).toBe(1);
        expect(census.totals.cases).toBe(1);
        expect(census.domains.map((domain: { domain: string }) => domain.domain)).toEqual([
          featuresDir ? "features/a.feature" : "features/alias.feature",
        ]);
      }),
  );

  it("lint の警告は探索の代表パスでなく、登録した別名と linkId を使う", async () =>
    withAliasOnly("features", CONTENT.replace("    Then 一覧が表示される\n", ""), async (root) => {
      const result = cli(root, "check");
      expect(result.status, result.stderr).toBe(1);
      expect(JSON.parse(result.stdout).warnings).toEqual([
        expect.objectContaining({
          kind: "missing-then",
          path: "features/alias.feature",
          linkId: "alias-link",
        }),
      ]);
    }));

  it.each(["EACCES", "EIO"])("探索後の %s を未登録 feature として握り潰さない", async (code) =>
    withAliasOnly("features", CONTENT, async (root) => {
      fault.target = path.join(root, "features/alias.feature");
      // resolveWithinRoot の実体確認の次に行う、照合用 realpath を失敗させる。
      fault.remaining = 2;
      fault.error = Object.assign(new Error("実体照合の失敗"), { code });
      await expect(
        checkDrift(path.join(root, "traceability.yaml"), root, { featuresDir: "features" }),
      ).rejects.toBe(fault.error);
    }),
  );
});
