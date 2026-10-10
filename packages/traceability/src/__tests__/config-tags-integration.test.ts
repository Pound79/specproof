import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverConfig } from "../config.js";
import { checkDrift } from "../check.js";
import { buildStats, type FeatureScenarios } from "../stats.js";
import { parseScenarios } from "../feature-scan.js";
import { readFileOrNull } from "../hash.js";
import { resolveWithinRoot } from "../resolve.js";

// CLI がつなぐ config → engine の合成を確かめる
// （cli-check.ts: checkDrift(..., { featuresDir: config.featuresDir })、
//  cli-stats.ts: buildStats(features)）。各部品の単体テストとは別に、
// 配線が黙って外れたときに気づけるようにする。

const created: string[] = [];

const makeRepo = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), "bddtrace-int-"));
  created.push(root);
  await mkdir(path.join(root, "features"), { recursive: true });
  await writeFile(
    path.join(root, "specproof.config.yaml"),
    ["layout:", "  manifest: traceability.yaml", "  featuresDir: features", ""].join("\n"),
  );
  await writeFile(path.join(root, "traceability.yaml"), "version: 1\nlinks: []\n");
  await writeFile(
    path.join(root, "features/demo.feature"),
    [
      "# language: ja",
      "機能: デモ",
      "",
      "@fixme",
      "シナリオ: 使えないタグが残る",
      "  前提 何かがある",
      "",
      "@out-of-scope",
      "シナリオ: 理由なし対象外",
      "  前提 何かがある",
      "",
    ].join("\n"),
  );
  return root;
};

const checkWithConfig = async (root: string) => {
  const config = discoverConfig({ root });
  // cli-check.ts と同じ呼び方。
  return checkDrift(config.manifestPath, config.repoRoot, { featuresDir: config.featuresDir });
};

const kinds = (report: Awaited<ReturnType<typeof checkWithConfig>>, kind: string) =>
  report.warnings.filter((w) => w.kind === kind);

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("config → checkDrift の配線（cli-check の経路）", () => {
  it("設定の featuresDir 配下で使えないタグと理由なしの @out-of-scope を検出する", async () => {
    const root = await makeRepo();
    const report = await checkWithConfig(root);

    expect(kinds(report, "disallowed-tag").map((w) => w.path)).toEqual(["features/demo.feature"]);
    expect(kinds(report, "missing-reason").map((w) => w.path)).toEqual(["features/demo.feature"]);
  });
});

describe("集計の継承と理由lintの境界", () => {
  it.each(["Feature", "Rule"])(
    "%sの@out-of-scopeは集計では継承し、親に理由があっても missing-reason にする",
    async (scope) => {
      const root = await makeRepo();
      const prefix = scope === "Feature" ? "" : "Feature: 条件\n";
      await writeFile(
        path.join(root, "features/demo.feature"),
        `${prefix}# 合意済みの理由\n@out-of-scope\n${scope}: 対象範囲\nScenario: 条件\n Given 条件\n`,
      );
      const report = await checkWithConfig(root);
      // 継承した宣言は理由の置き場所が定まらず一括で外せるので、シナリオ自身に付けさせる。
      expect(kinds(report, "missing-reason")).toHaveLength(1);
      expect(kinds(report, "missing-reason")[0]?.message).toContain("inherits");
      const content = await readFileOrNull(path.join(root, "features/demo.feature"));
      const stats = buildStats([
        { domain: "features/demo.feature", scenarios: parseScenarios(content ?? "") },
      ]);
      // runner は親のタグを継承するので、集計もそれに合わせる。
      expect(stats.totals).toMatchObject({ total: 1, outOfScope: 1, disallowed: 0 });
    },
  );

  it.each([
    ["Feature", "@fixme"],
    ["Rule", "@fixme"],
    ["Feature", "@skip"],
    ["Rule", "@skip"],
  ])(
    "%sの%sは継承して disallowed-tag にし、集計でも使えないタグとして数える",
    async (scope, tag) => {
      const root = await makeRepo();
      const prefix = scope === "Feature" ? "" : "Feature: 条件\n";
      await writeFile(
        path.join(root, "features/demo.feature"),
        `${prefix}# 旧来の理由\n${tag}\n${scope}: 対象範囲\nScenario: 条件\n Given 条件\n`,
      );
      const report = await checkWithConfig(root);
      expect(kinds(report, "disallowed-tag")).toHaveLength(1);
      expect(kinds(report, "disallowed-tag")[0]?.message).toContain(tag);
      const content = await readFileOrNull(path.join(root, "features/demo.feature"));
      const stats = buildStats([
        { domain: "features/demo.feature", scenarios: parseScenarios(content ?? "") },
      ]);
      expect(stats.totals).toMatchObject({ total: 1, disallowed: 1 });
      expect(stats.done).toBe(false);
    },
  );

  it("子で付け直した@out-of-scopeは親の理由で免除しない", async () => {
    const root = await makeRepo();
    await writeFile(
      path.join(root, "features/demo.feature"),
      "# 親の理由\n@out-of-scope\nFeature: 条件\n@out-of-scope\nScenario: 自身の理由なし\n Given 条件\n",
    );
    const report = await checkWithConfig(root);
    expect(kinds(report, "missing-reason")).toHaveLength(1);
  });

  it("Featureの一般コメントでScenarioの理由欠落を消さない", async () => {
    const root = await makeRepo();
    await writeFile(
      path.join(root, "features/demo.feature"),
      "# 一般的なFeature説明\nFeature: 条件\n@out-of-scope\nScenario: 理由なし\n Given 条件\n",
    );
    const report = await checkWithConfig(root);
    expect(kinds(report, "missing-reason")).toHaveLength(1);
  });
});

describe("config → buildStats の配線（cli-stats の経路）", () => {
  it("使えないタグが残れば done にしない", async () => {
    const root = await makeRepo();
    const config = discoverConfig({ root });

    const content = await readFileOrNull(
      resolveWithinRoot(config.repoRoot, "features/demo.feature"),
    );
    const features: FeatureScenarios[] = [
      { domain: "features/demo.feature", scenarios: parseScenarios(content ?? "") },
    ];

    // cli-stats.ts と同じ呼び方。
    const report = buildStats(features);

    expect(report.totals).toMatchObject({ total: 2, disallowed: 1, outOfScope: 1 });
    expect(report.done).toBe(false);
  });
});
