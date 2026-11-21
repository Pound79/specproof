import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseScenarios } from "../feature-scan.js";
import { buildStats, formatStats } from "../stats.js";

// E2E を書く途中で仕様に答えの無い問いが出たら、その問いに依存するシナリオに @question:<ID> を付ける。
// 答えが出たときに、どの feature のどのシナリオを見直すかを stats から引けるようにする。
const report = (features: Record<string, string>) =>
  buildStats(
    Object.entries(features).map(([domain, content]) => ({
      domain,
      scenarios: parseScenarios(content),
    })),
  );

describe("仕様の未決の問いに依存するシナリオ", () => {
  it("問いの ID ごとに、依存するシナリオの数と feature を数える", () => {
    const stats = report({
      "features/roster.feature": `Feature: 名簿
  @question:perm-Q5
  Scenario: 閲覧者は名簿を書き出せない
    Given 条件
  @question:perm-Q5 @question:perm-Q7
  Scenario: 閲覧者は名簿を印刷できない
    Given 条件
  Scenario: 管理者は名簿を書き出せる
    Given 条件
`,
      "features/export.feature": `Feature: 書き出し
  @question:perm-Q5
  Scenario: 閲覧者は書き出しの画面を開けない
    Given 条件
`,
    });
    expect(stats.questions).toEqual([
      {
        id: "perm-Q5",
        scenarios: 3,
        features: ["features/export.feature", "features/roster.feature"],
      },
      { id: "perm-Q7", scenarios: 1, features: ["features/roster.feature"] },
    ]);
  });

  it("Feature と Rule に付けた問いは配下のシナリオに継承する", () => {
    const stats = report({
      "features/notice.feature": `@question:notice-1
Feature: お知らせ
  Scenario: 一つ目
    Given 条件
  Rule: 既読
    @question:notice-2
    Scenario: 二つ目
      Given 条件
`,
    });
    expect(stats.questions).toEqual([
      { id: "notice-1", scenarios: 2, features: ["features/notice.feature"] },
      { id: "notice-2", scenarios: 1, features: ["features/notice.feature"] },
    ]);
  });

  it("ID の無い @question: は数えず、問いが無ければ空にする。done には影響させない", () => {
    const stats = report({
      "features/a.feature": `Feature: A
  @question:
  Scenario: 条件
    Given 条件
`,
    });
    expect(stats.questions).toEqual([]);
    expect(stats.done).toBe(true);
    expect(formatStats(stats)).not.toMatch(/Open spec questions/);
  });

  it("テキストに問いごとの件数と feature を出し、ID とパスは表示できる形にする", () => {
    const text = formatStats(
      report({
        "features/roster.feature": `Feature: 名簿
  @question:perm-Q5
  Scenario: 閲覧者は名簿を書き出せない
    Given 条件
`,
      }),
    );
    expect(text).toMatch(
      /Open spec questions \(scenarios that depend on an unanswered spec question\):\n {2}perm-Q5: 1 scenario\(s\) in features\/roster\.feature/,
    );
  });

  it("feature が多い問いは 3 件まで出し、残りの数を示す", () => {
    const features = Object.fromEntries(
      [1, 2, 3, 4, 5].map((n) => [
        `features/f${n}.feature`,
        `Feature: F${n}\n  @question:q\n  Scenario: 条件\n    Given 条件\n`,
      ]),
    );
    expect(formatStats(report(features))).toMatch(
      /q: 5 scenario\(s\) in features\/f1\.feature, features\/f2\.feature, features\/f3\.feature and 2 more feature\(s\)/,
    );
  });
});

describe("問いの数え方の細部と古い形の入力", () => {
  it("Examples に付けた問いは Outline 全体を 1 件として数え、Feature とシナリオの両方に付いた同じ ID は 1 回だけ数える", () => {
    const stats = report({
      "features/o.feature": `@question:q
Feature: O
  @question:q
  Scenario Outline: 条件 <n>
    Given <n>
    Examples:
      | n |
      | 1 |
    @question:r
    Examples:
      | n |
      | 2 |
`,
    });
    expect(stats.questions).toEqual([
      { id: "q", scenarios: 1, features: ["features/o.feature"] },
      { id: "r", scenarios: 1, features: ["features/o.feature"] },
    ]);
  });

  it("questions の無い古い形のレポートも formatStats に渡せる", () => {
    const { questions: _ignored, ...legacy } = report({
      "features/a.feature": "Feature: A\n  Scenario: 条件\n    Given 条件\n",
    });
    expect(formatStats(legacy)).toMatch(/Scenario census/);
  });
});

describe("specproof-stats --json の questions", () => {
  const statsCli = fileURLToPath(new URL("../../dist/cli-stats.js", import.meta.url));
  let root: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("既存のキーを変えずに questions を足す", () => {
    root = mkdtempSync(path.join(os.tmpdir(), "specproof-stats-questions-"));
    mkdirSync(path.join(root, "features"));
    writeFileSync(
      path.join(root, "features", "a.feature"),
      "Feature: A\n  @question:q1\n  Scenario: 条件\n    Given 条件\n",
    );
    writeFileSync(
      path.join(root, "traceability.yaml"),
      "version: 1\nlinks:\n  - id: a\n    label: A\n    spec: []\n    impl: []\n    features:\n      - path: features/a.feature\n        hash: PENDING\n",
    );
    const result = spawnSync(process.execPath, [statsCli, "--json"], {
      cwd: root,
      encoding: "utf8",
    });
    const json = JSON.parse(result.stdout);
    expect(json.questions).toEqual([{ id: "q1", scenarios: 1, features: ["features/a.feature"] }]);
    expect(json.totals.total).toBe(1);
    expect(json.done).toBe(true);
  });
});
