import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverConfig } from "../config.js";

// manifest の段から親の設定ファイルへルートを移すとき、その段（と途中の段）にある設定ファイルの
// 不備を素通りさせない。ルートを移すと、その段の設定は読まれず検証もされなくなるため。
const withRepo = (run: (root: string, e2e: string) => void): void => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "subdir-local-config-")));
  const e2e = path.join(root, "e2e");
  mkdirSync(e2e);
  writeFileSync(path.join(e2e, "traceability.yaml"), "version: 1\nlinks: []\n");
  writeFileSync(
    path.join(root, "specproof.config.yaml"),
    'layout:\n  manifest: "e2e/traceability.yaml"\n',
  );
  try {
    run(root, e2e);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe("manifest の段にある設定ファイルの不備", () => {
  it("不備が無ければ親の設定ファイルの段をルートにする（前提の確認）", () =>
    withRepo((root, e2e) => {
      expect(discoverConfig({ startDir: e2e }).repoRoot).toBe(root);
    }));

  describe.skipIf(process.platform === "win32")("symlink", () => {
    it("リンク切れの現行名の設定ファイルがあれば、親へ移らずにエラーで止める", () =>
      withRepo((_root, e2e) => {
        symlinkSync("missing.yaml", path.join(e2e, "specproof.config.yaml"));
        expect(() => discoverConfig({ startDir: e2e })).toThrow(/specproof\.config\.yaml/);
      }));

    it("途中の段にリンク切れの設定ファイルがあれば、親の設定ファイルを採らない", () =>
      withRepo((root, e2e) => {
        const nested = path.join(e2e, "pkg");
        mkdirSync(nested);
        writeFileSync(path.join(nested, "traceability.yaml"), "version: 1\nlinks: []\n");
        symlinkSync("missing.yaml", path.join(e2e, "specproof.config.yml"));
        writeFileSync(
          path.join(root, "specproof.config.yaml"),
          'layout:\n  manifest: "e2e/pkg/traceability.yaml"\n',
        );
        expect(() => discoverConfig({ startDir: nested })).not.toThrow();
        expect(discoverConfig({ startDir: nested }).repoRoot).toBe(nested);
      }));
  });

  for (const legacy of ["bdd-kit.config.yaml", "bdd-kit.config.yml"]) {
    it(`旧名の設定ファイル（${legacy}）があれば、親へ移らずに名前の変更を案内して止める`, () =>
      withRepo((_root, e2e) => {
        writeFileSync(path.join(e2e, legacy), "version: 1\n");
        expect(() => discoverConfig({ startDir: e2e })).toThrow(
          `${legacy} is no longer read; rename it to specproof.config.yaml`,
        );
      }));

    it(`途中の段に旧名の設定ファイル（${legacy}）があれば、親の設定ファイルを採らない`, () =>
      withRepo((root, e2e) => {
        const nested = path.join(e2e, "pkg");
        mkdirSync(nested);
        writeFileSync(path.join(nested, "traceability.yaml"), "version: 1\nlinks: []\n");
        writeFileSync(path.join(e2e, legacy), "version: 1\n");
        writeFileSync(
          path.join(root, "specproof.config.yaml"),
          'layout:\n  manifest: "e2e/pkg/traceability.yaml"\n',
        );
        expect(discoverConfig({ startDir: nested }).repoRoot).toBe(nested);
      }));
  }
});
