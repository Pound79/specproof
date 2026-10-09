import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverConfig } from "../config.js";

// 設定したつもりの値が型違いで「未設定」に落ちると、監査が黙って無効になる。
// キーの省略（と空の値）は既定値を使い、値があるのに型が違えばエラーにする。
const withConfig = (yaml: string, run: (root: string) => void): void => {
  const root = mkdtempSync(path.join(os.tmpdir(), "config-types-"));
  try {
    writeFileSync(path.join(root, "specproof.config.yaml"), yaml);
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe("型の誤った設定値を拒否する", () => {
  it.each([
    ['layout:\n  implGlobs: "src/**/*.ts"\n', /layout\.implGlobs/],
    ['layout:\n  implGlobs: ["src/**/*.ts", 3]\n', /layout\.implGlobs/],
    ['layout:\n  implGlobs: [""]\n', /layout\.implGlobs/],
    ['strictUnregisteredImpl: "true"\n', /strictUnregisteredImpl/],
    ["strictUnregisteredImpl: yes\n", /strictUnregisteredImpl/],
    ["strictUnregisteredSpecHeadings: 1\n", /strictUnregisteredSpecHeadings/],
    ["layout:\n  featuresDir: 42\n", /layout\.featuresDir/],
    ['layout:\n  featuresDir: ""\n', /layout\.featuresDir/],
    ["layout:\n  manifest: [a]\n", /layout\.manifest/],
    ["layout:\n  pagesDir: true\n", /layout\.pagesDir/],
    ["layout:\n  candidateSuffix: 1\n", /layout\.candidateSuffix/],
    ["layout: features\n", /layout/],
    ["tags: fixme\n", /tags/],
    ["- just\n- a list\n", /mapping/],
  ])("%s", (yaml, message) =>
    withConfig(yaml, (root) => {
      expect(() => discoverConfig({ root })).toThrow(message);
    }),
  );
});

describe("省略と正しい値は従来どおり受け付ける", () => {
  it("キーの省略と空の値（null）は既定値を使う", () =>
    withConfig("layout:\n  implGlobs:\nstrictUnregisteredImpl:\ntags:\n", (root) => {
      const config = discoverConfig({ root });
      expect(config.implGlobs).toBeUndefined();
      expect(config.strictUnregisteredImpl).toBe(false);
    }));

  it("正しい型の値を読む", () =>
    withConfig(
      [
        "layout:",
        "  featuresDir: features",
        '  implGlobs: ["src/**/*.ts"]',
        "strictUnregisteredImpl: true",
        "strictUnregisteredSpecHeadings: false",
        "",
      ].join("\n"),
      (root) => {
        const config = discoverConfig({ root });
        expect(config.featuresDir).toBe("features");
        expect(config.implGlobs).toEqual(["src/**/*.ts"]);
        expect(config.strictUnregisteredImpl).toBe(true);
      },
    ));

  it("空の設定ファイルは既定値で動く", () =>
    withConfig("", (root) => {
      expect(discoverConfig({ root }).implGlobs).toBeUndefined();
    }));
});

describe("エラーメッセージ", () => {
  const withFile = (name: string, yaml: string, run: (root: string) => void): void => {
    const root = mkdtempSync(path.join(os.tmpdir(), "config-message-"));
    try {
      writeFileSync(path.join(root, name), yaml);
      run(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  it.each(["specproof.config.yml", "bdd-kit.config.yaml"])("実際に読んだ %s を示す", (name) =>
    withFile(name, "layout:\n  manifest: [a]\n", (root) => {
      expect(() => discoverConfig({ root })).toThrow(
        new RegExp(`^${name.replace(/\./g, "\\.")}: `),
      );
    }),
  );

  it("退役したタグ設定の値に含まれる改行をそのまま出さない", () =>
    withConfig('tags:\n  fixme: "x\\n::error file=evil::INJECTED"\n', (root) => {
      expect(() => discoverConfig({ root })).toThrow(/tags\.fixme.*retired/);
      try {
        discoverConfig({ root });
      } catch (error) {
        expect((error as Error).message).not.toContain("\n");
      }
    }));
});
