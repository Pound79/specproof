import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkDrift } from "../check.js";
import { isCheckFailure } from "../cli-check-format.js";
import { discoverConfig } from "../config.js";
import { parseScenarios } from "../feature-scan.js";
import { buildStats, formatStats } from "../stats.js";
import { RETIRED_TAGS } from "../index.js";

// @fixme / @skip は退役した。実装待ちは @red-contract、人が確かめる条件は @human、
// 受け入れ条件から外すものは @out-of-scope（理由コメント必須）で表す。

const feature = (lines: string[]): string => ["Feature: f", ...lines].join("\n");

describe("退役タグ", () => {
  it("公開する退役タグは @fixme・@skip と、失敗を想定扱いにする @fail", () => {
    expect(RETIRED_TAGS).toEqual(["@fixme", "@skip", "@fail"]);
  });
});

describe("buildStats", () => {
  const scenarios = parseScenarios(
    feature([
      "  @red-contract",
      "  Scenario: pending",
      "    When a",
      "    Then b",
      "  @human",
      "  Scenario: by hand",
      "    When c",
      "    Then d",
      "  # reason: not part of this delivery",
      "  @out-of-scope",
      "  Scenario: excluded",
      "    When e",
      "    Then f",
      "  @skip",
      "  Scenario: old tag",
      "    When g",
      "    Then h",
    ]),
  );

  it("実装待ち・人の確認・対象外・退役タグを数える", () => {
    const report = buildStats([{ domain: "a.feature", scenarios }]);
    expect(report.totals).toMatchObject({
      total: 4,
      phase: { draft: 0, pending: 1, complete: 3 },
      verification: { machine: 3, human: 1 },
      outOfScope: 1,
      retired: 1,
    });
    expect(report.totals).not.toHaveProperty("fixme");
    expect(report.totals).not.toHaveProperty("skip");
  });

  it("完了は実装待ち 0 かつ退役タグ 0", () => {
    expect(buildStats([{ domain: "a.feature", scenarios }]).done).toBe(false);
    const clean = parseScenarios(feature(["  Scenario: s", "    When a", "    Then b"]));
    expect(buildStats([{ domain: "b.feature", scenarios: clean }]).done).toBe(true);
    const pending = parseScenarios(
      feature(["  @red-contract", "  Scenario: s", "    When a", "    Then b"]),
    );
    expect(buildStats([{ domain: "c.feature", scenarios: pending }]).done).toBe(false);
  });

  it("表示に @fixme / @skip の列を出さず、残っていれば外すよう促す", () => {
    const text = formatStats(buildStats([{ domain: "a.feature", scenarios }]));
    expect(text).toContain("out-of-scope 1");
    expect(text).toContain("@red-contract remaining: 1");
    expect(text).toMatch(/retired tags.*1/);
    expect(text).not.toMatch(/@fixme \d/);
  });
});

describe("設定", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "retired-config-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  for (const key of ["fixme", "skip"]) {
    it(`tags.${key} を書いた設定は、退役を知らせて失敗する`, async () => {
      await writeFile(
        path.join(root, "specproof.config.yaml"),
        `layout:\n  manifest: traceability.yaml\ntags:\n  ${key}: "@${key}"\n`,
      );
      expect(() => discoverConfig({ root })).toThrow(/tags\.(fixme|skip).*retired/);
    });
  }

  it("ほかのタグ設定（slow など）は今までどおり書ける", async () => {
    await writeFile(
      path.join(root, "specproof.config.yaml"),
      'layout:\n  manifest: traceability.yaml\ntags:\n  slow: "@slow"\n',
    );
    expect(() => discoverConfig({ root })).not.toThrow();
  });
});

describe("checkDrift", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "retired-check-"));
    await mkdir(path.join(root, "features"));
    await writeFile(
      path.join(root, "traceability.yaml"),
      [
        "version: 1",
        "links:",
        "  - id: a",
        "    label: A",
        "    spec: []",
        "    impl: []",
        "    features:",
        "      - path: features/a.feature",
        "        hash: x",
        "",
      ].join("\n"),
    );
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const warningsFor = async (content: string) => {
    await writeFile(path.join(root, "features/a.feature"), content);
    const report = await checkDrift(path.join(root, "traceability.yaml"), root, {
      featuresDir: "features",
    });
    return report;
  };

  it("@fixme / @skip（継承を含む）を retired-tag にし、--strict で失敗させる", async () => {
    const report = await warningsFor(
      ["@skip", "Feature: f", "  # reason: x", "  Scenario: s", "    When a", "    Then b"].join(
        "\n",
      ),
    );
    const retired = report.warnings.filter((warning) => warning.kind === "retired-tag");
    expect(retired).toHaveLength(1);
    expect(retired[0].message).toMatch(/@red-contract|@human|@out-of-scope/);
    expect(isCheckFailure({ ...report, clean: true, warnings: retired }, true)).toBe(true);
  });

  it("理由コメントの無い @out-of-scope を missing-reason にする", async () => {
    const report = await warningsFor(
      feature(["  @out-of-scope", "  Scenario: s", "    When a", "    Then b"]),
    );
    expect(report.warnings.map((warning) => warning.kind)).toContain("missing-reason");
    const withReason = await warningsFor(
      feature(["  # reason: x", "  @out-of-scope", "  Scenario: s", "    When a", "    Then b"]),
    );
    expect(withReason.warnings.map((warning) => warning.kind)).not.toContain("missing-reason");
  });
});

describe("@out-of-scope の置き場所と組み合わせ", () => {
  it("Examples に付けた @out-of-scope は、ほかの状態タグと同じく拒否する", () => {
    const scenarios = parseScenarios(
      feature([
        "  Scenario Outline: o",
        "    When <a>",
        "    Then b",
        "    @out-of-scope",
        "    Examples:",
        "      | a |",
        "      | x |",
      ]),
    );
    expect(() => buildStats([{ domain: "a.feature", scenarios }])).toThrow(/Examples/);
  });

  it("@out-of-scope と @red-contract の併記は拒否する（実行しないのに完了を止める）", () => {
    const scenarios = parseScenarios(
      feature(["  @out-of-scope @red-contract", "  Scenario: s", "    When a", "    Then b"]),
    );
    expect(() => buildStats([{ domain: "a.feature", scenarios }])).toThrow(/@out-of-scope/);
  });
});

describe("checkDrift の @out-of-scope と missing-then", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "out-of-scope-check-"));
    await mkdir(path.join(root, "features"));
    await writeFile(
      path.join(root, "traceability.yaml"),
      "version: 1\nlinks:\n  - id: a\n    label: A\n    spec: []\n    impl: []\n    features:\n      - path: features/a.feature\n        hash: x\n",
    );
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const kindsFor = async (content: string): Promise<string[]> => {
    await writeFile(path.join(root, "features/a.feature"), content);
    const report = await checkDrift(path.join(root, "traceability.yaml"), root, {
      featuresDir: "features",
    });
    return report.warnings.map((warning) => warning.kind);
  };

  it("Feature・Rule から継承した @out-of-scope は、理由コメントがあっても missing-reason にする", async () => {
    expect(
      await kindsFor(
        [
          "# reason: x",
          "@out-of-scope",
          "Feature: f",
          "  Scenario: s",
          "    When a",
          "    Then b",
        ].join("\n"),
      ),
    ).toContain("missing-reason");
    expect(
      await kindsFor(
        [
          "Feature: f",
          "  # reason: x",
          "  @out-of-scope",
          "  Rule: r",
          "    Scenario: s",
          "      When a",
          "      Then b",
        ].join("\n"),
      ),
    ).toContain("missing-reason");
  });

  it("確認の無い @out-of-scope のシナリオは missing-then にしないが、@human・@draft はする", async () => {
    expect(
      await kindsFor(feature(["  # reason: x", "  @out-of-scope", "  Scenario: s", "    When a"])),
    ).not.toContain("missing-then");
    for (const tag of ["@human", "@draft"]) {
      expect(await kindsFor(feature([`  ${tag}`, "  Scenario: s", "    When a"]))).toContain(
        "missing-then",
      );
    }
  });

  it("@fail（失敗を想定扱いにする）も retired-tag にする", async () => {
    expect(
      await kindsFor(feature(["  @fail", "  Scenario: s", "    When a", "    Then b"])),
    ).toContain("retired-tag");
  });
});
