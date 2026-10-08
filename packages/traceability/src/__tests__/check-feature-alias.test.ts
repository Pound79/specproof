import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkDrift } from "../check.js";

// 探索は実体で重複を除いて最初の論理パスを残し、manifest との照合は論理パスで行っていた。
// 登録済み feature への別名リンクが先に見つかると、同じ実体なのに未登録と誤判定される。
const unregistered = async (registered: string, alias: string): Promise<string[]> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "feature-alias-"));
  try {
    await mkdir(path.join(root, "features"));
    await writeFile(
      path.join(root, registered),
      "Feature: 実体\n  Scenario: 条件\n    Given 条件\n",
    );
    await symlink(path.basename(registered), path.join(root, alias));
    await writeFile(
      path.join(root, "traceability.yaml"),
      `version: 1\nlinks:\n  - id: a\n    label: A\n    spec: []\n    impl: []\n    features:\n      - path: ${registered}\n        hash: x\n`,
    );
    const report = await checkDrift(path.join(root, "traceability.yaml"), root, {
      featuresDir: "features",
    });
    return report.warnings
      .filter((warning) => warning.kind === "unregistered-feature")
      .map((warning) => warning.path ?? "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe.skipIf(process.platform === "win32")("登録済み feature への別名リンク", () => {
  it("別名の方が名前順で先でも、未登録と判定しない", async () => {
    expect(await unregistered("features/z.feature", "features/a.feature")).toEqual([]);
  });

  it("別名の方が名前順で後でも、未登録と判定しない", async () => {
    expect(await unregistered("features/a.feature", "features/z.feature")).toEqual([]);
  });
});
