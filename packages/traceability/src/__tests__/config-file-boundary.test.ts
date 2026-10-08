import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverConfig } from "../config.js";

const configModule = fileURLToPath(new URL("../../dist/config.js", import.meta.url));

// 設定ファイルは manifest や探索先の境界を決める入力なので、それ自体にも同じ境界を適用する。
const withRepo = (run: (root: string, outside: string) => void): void => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "config-boundary-"));
  const root = path.join(temp, "repo");
  const outside = path.join(temp, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  try {
    run(root, outside);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
};

const CONFIG = "specproof.config.yaml";

describe.skipIf(process.platform === "win32")("設定ファイルの読み取り境界", () => {
  it("repo の外を指す symlink を拒否する", () =>
    withRepo((root, outside) => {
      writeFileSync(path.join(outside, CONFIG), "tags:\n  fixme: todo\n");
      symlinkSync(path.join(outside, CONFIG), path.join(root, CONFIG));
      expect(() => discoverConfig({ root })).toThrow(/outside the repository root/);
      expect(() => discoverConfig({ root })).not.toThrow(/Manifest path/);
    }));

  it("リンク切れを「設定なし」として黙って既定値にしない", () =>
    withRepo((root) => {
      symlinkSync("missing.yaml", path.join(root, CONFIG));
      expect(() => discoverConfig({ root })).toThrow(new RegExp(CONFIG.replace(".", "\\.")));
    }));

  it("ディレクトリを拒否する", () =>
    withRepo((root) => {
      mkdirSync(path.join(root, CONFIG));
      expect(() => discoverConfig({ root })).toThrow(/regular file/);
    }));

  it("FIFO を待たずに拒否する", () =>
    withRepo((root) => {
      execFileSync("mkfifo", [path.join(root, CONFIG)]);
      // 同期読み込みが FIFO で止まるとテストのタイムアウトでも中断できないので、別プロセスで測る。
      const script = `
        const { discoverConfig } = await import(${JSON.stringify(configModule)});
        try { discoverConfig({ root: ${JSON.stringify(root)} }); process.stdout.write("accepted"); }
        catch (error) { process.stdout.write(error.message); }
      `;
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        encoding: "utf8",
        timeout: 5_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.stdout).toMatch(/regular file/);
    }));

  it("上限を超える大きさの設定ファイルを拒否する", () =>
    withRepo((root) => {
      writeFileSync(path.join(root, CONFIG), `# ${"x".repeat(1024 * 1024)}\n`);
      expect(() => discoverConfig({ root })).toThrow(/exceeds/);
    }));

  it("repo 内の実体を指す symlink は従来どおり読む", () =>
    withRepo((root) => {
      mkdirSync(path.join(root, "config"));
      writeFileSync(path.join(root, "config", "real.yaml"), "tags:\n  fixme: todo\n");
      symlinkSync("config/real.yaml", path.join(root, CONFIG));
      expect(discoverConfig({ root }).fixmeTag).toBe("@todo");
    }));
});
