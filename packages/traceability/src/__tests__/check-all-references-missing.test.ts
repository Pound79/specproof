import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkDrift } from "../check.js";

// allReferencesMissing は「参照がすべてファイルごと見つからない」ときだけ立つ。
describe("checkDrift の allReferencesMissing", () => {
  let root: string;
  const manifestPath = (): string => path.join(root, "traceability.yaml");

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "traceability-all-missing-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const link = (body: string): string => `version: 1\nlinks:\n  - id: a\n    label: A\n${body}`;

  it("参照が 0 件の manifest では立たない", async () => {
    await writeFile(manifestPath(), "version: 1\nlinks: []\n", "utf8");
    const report = await checkDrift(manifestPath(), root);
    expect(report.allReferencesMissing).toBe(false);
  });

  it("features だけの参照がすべて見つからなければ立つ", async () => {
    await writeFile(
      manifestPath(),
      link(
        "    spec: []\n    impl: []\n    features:\n      - path: f/a.feature\n        hash: PENDING\n",
      ),
      "utf8",
    );
    const report = await checkDrift(manifestPath(), root);
    expect(report.allReferencesMissing).toBe(true);
  });

  it("同じ参照が重複していても、すべて見つからなければ立ち、bothSidesChanged は空になる", async () => {
    const ref = "      - path: src/a.ts\n        hash: PENDING\n";
    await writeFile(
      manifestPath(),
      link(
        `    spec:\n      - path: docs/s.md\n        heading: "R"\n        hash: PENDING\n    impl:\n${ref}${ref}    features: []\n`,
      ),
      "utf8",
    );
    const report = await checkDrift(manifestPath(), root);
    expect(report.allReferencesMissing).toBe(true);
    expect(report.bothSidesChanged).toEqual([]);
    expect(report.clean).toBe(false);
  });

  it("1 件でも読めるファイルがあれば立たない", async () => {
    await writeFile(path.join(root, "a.ts"), "export {};\n", "utf8");
    await writeFile(
      manifestPath(),
      link(
        "    spec: []\n    impl:\n      - path: a.ts\n        hash: PENDING\n      - path: gone.ts\n        hash: PENDING\n    features: []\n",
      ),
      "utf8",
    );
    const report = await checkDrift(manifestPath(), root);
    expect(report.allReferencesMissing).toBe(false);
  });
});
