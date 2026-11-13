import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// src/__tests__/*.test.ts -> repo root is four levels up.
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../..");
const read = (relPath: string): string => readFileSync(path.join(repoRoot, relPath), "utf8");

describe("playwright の雛形の trace", () => {
  const config = read("templates/playwright/playwright.config.ts");
  const readme = read("templates/playwright/README.md");

  // trace の設定行と、その真上に続くコメントの塊。
  const traceSetting = config.match(/((?:^[ \t]*\/\/.*\n)+)[ \t]*trace: "([^"]+)",/m);

  it("ローカル（retries 0）でも失敗した回の trace を残す", () => {
    expect(traceSetting?.[2]).toBe("retain-on-failure");
  });

  it("設定のコメントで、trace に認証情報が入るので共有しない・CI の成果物に上げないと書く", () => {
    const comment = traceSetting?.[1] ?? "";
    expect(comment).toMatch(/cookies/i);
    expect(comment).toMatch(/localStorage/);
    expect(comment).toMatch(/test-results/);
    expect(comment).toMatch(/playwright-report/);
    expect(comment).toMatch(/CI artifacts/i);
  });

  it("README は trace を共有しない・CI の成果物に上げないと書き、再試行のときだけ残るとは書かない", () => {
    const row = readme
      .split("\n")
      .find((line) => line.startsWith("| Traces, screenshots and videos"));
    expect(row).toBeDefined();
    expect(row).not.toMatch(/first retry/);
    expect(row).toMatch(/Do not share/);
    expect(row).toMatch(/Do not upload them as CI artifacts/);
  });

  it("雛形の .gitignore は test-results と playwright-report を除外する", () => {
    const ignored = read("templates/playwright/gitignore").split("\n");
    expect(ignored).toContain("test-results");
    expect(ignored).toContain("playwright-report");
  });
});
