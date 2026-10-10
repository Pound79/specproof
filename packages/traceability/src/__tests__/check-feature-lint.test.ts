import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkDrift } from "../check.js";
import { isCheckFailure, warningFailsUnderStrict } from "../cli-check-format.js";
import { discoverConfig } from "../config.js";

const A = [
  "# language: ja",
  "機能: 配送",
  "",
  "  シナリオ: 確認が無い",
  "    もし 一覧を開く",
  "",
  "  シナリオ: 他社の配送は開けない",
  "    もし B 社の配送を開く",
  "    ならば B 社の項目は表示されない",
].join("\n");

const B = [
  "# language: ja",
  "機能: 配送 2",
  "",
  "  シナリオ: 他社のデータは見えない",
  "    もし B 社の配送を開く",
  "    ならば B 社の項目は表示されない",
  "",
  "  シナリオ: 他社の配送が見える",
  "    もし B 社の配送を開く",
  "    ならば B 社の項目が表示される",
].join("\n");

describe("checkDrift の feature lint", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "feature-lint-"));
    await mkdir(path.join(root, "features"));
    await writeFile(path.join(root, "features/a.feature"), A);
    await writeFile(path.join(root, "features/b.feature"), B);
    await writeFile(
      path.join(root, "traceability.yaml"),
      [
        "version: 1",
        "links:",
        "  - id: delivery",
        "    label: 配送",
        "    spec: []",
        "    impl: []",
        "    features:",
        "      - path: features/a.feature",
        "        hash: x",
        "      - path: features/b.feature",
        "        hash: x",
        "",
      ].join("\n"),
    );
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const lintWarnings = async () => {
    const report = await checkDrift(path.join(root, "traceability.yaml"), root, {
      featuresDir: "features",
    });
    return {
      report,
      lint: report.warnings.filter((warning) =>
        ["missing-then", "duplicate-scenario", "possible-contradiction"].includes(warning.kind),
      ),
    };
  };

  it("3 種類を、登録済み link の id とファイルを付けて warnings に出す", async () => {
    const { lint } = await lintWarnings();
    expect(lint.map((warning) => [warning.kind, warning.path, warning.linkId])).toEqual([
      ["missing-then", "features/a.feature", "delivery"],
      ["duplicate-scenario", "features/b.feature", "delivery"],
      ["possible-contradiction", "features/b.feature", "delivery"],
    ]);
  });

  it("--strict では既定で落とさず、strictFeatureLint で確認無しと重複だけを落とす", async () => {
    const { report } = await lintWarnings();
    const lintOnly = {
      ...report,
      clean: true,
      warnings: report.warnings.filter((warning) =>
        ["missing-then", "duplicate-scenario", "possible-contradiction"].includes(warning.kind),
      ),
    };
    expect(isCheckFailure(lintOnly, true)).toBe(false);
    expect(isCheckFailure(lintOnly, true, { strictFeatureLint: true })).toBe(true);
    expect(warningFailsUnderStrict("missing-then", { strictFeatureLint: true })).toBe(true);
    expect(warningFailsUnderStrict("duplicate-scenario", { strictFeatureLint: true })).toBe(true);
    expect(warningFailsUnderStrict("step-order", { strictFeatureLint: true })).toBe(true);
    expect(warningFailsUnderStrict("duplicate-scenario-name", { strictFeatureLint: true })).toBe(
      true,
    );
    expect(warningFailsUnderStrict("step-order")).toBe(false);
    // 矛盾の候補は人が判断するので、opt-in でも落とさない。
    expect(warningFailsUnderStrict("possible-contradiction", { strictFeatureLint: true })).toBe(
      false,
    );
  });

  it("設定ファイルの strictFeatureLint を読み、既定は false", async () => {
    await writeFile(
      path.join(root, "specproof.config.yaml"),
      "layout:\n  manifest: traceability.yaml\n",
    );
    expect(discoverConfig({ root }).strictFeatureLint).toBe(false);
    await writeFile(
      path.join(root, "specproof.config.yaml"),
      "layout:\n  manifest: traceability.yaml\nstrictFeatureLint: true\n",
    );
    expect(discoverConfig({ root }).strictFeatureLint).toBe(true);
  });
});
