import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "vitest";
import { discoverConfig } from "../config.js";
import { computeFileHash } from "../hash.js";
import { saveManifest } from "../manifest.js";
import { updateManifestHashes } from "../update.js";

const MANIFEST = [
  "# 共有 manifest",
  "version: 1",
  "links:",
  "  - id: a",
  "    label: A",
  "    spec: []",
  "    impl:",
  "      - path: src/a.ts",
  "        hash: PENDING # 未承認",
  "    features: []",
  "",
].join("\n");

const fixture = async (run: (root: string, outside: string) => Promise<void>): Promise<void> => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "manifest-symlink-"));
  const root = path.join(temp, "repo");
  const outside = path.join(temp, "outside");
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, "shared"));
  await mkdir(path.join(root, "src"));
  await mkdir(outside);
  await writeFile(path.join(root, "src/a.ts"), "export {};\n");
  try {
    await run(root, outside);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
};

describe.skipIf(process.platform === "win32")("symlink の manifest", () => {
  test("repo 内の実体を指すリンクは実体を更新し、リンクを残す", async () =>
    fixture(async (root) => {
      const target = path.join(root, "shared/m.yaml");
      const link = path.join(root, "docs/traceability.yaml");
      await writeFile(target, MANIFEST);
      await symlink("../shared/m.yaml", link);

      const result = await updateManifestHashes(link, root);

      assert.equal(result.changes.length, 1);
      assert.ok((await lstat(link)).isSymbolicLink());
      assert.equal(await readlink(link), "../shared/m.yaml");
      const hash = await computeFileHash(path.join(root, "src/a.ts"));
      assert.equal(await readFile(target, "utf8"), MANIFEST.replace("PENDING", hash));
    }));

  test("CLI の設定解決はリンク経由の manifest を通す", async () =>
    fixture(async (root) => {
      await writeFile(path.join(root, "shared/m.yaml"), MANIFEST);
      await symlink("../shared/m.yaml", path.join(root, "docs/traceability.yaml"));
      const config = discoverConfig({ root, manifest: path.join(root, "docs/traceability.yaml") });
      assert.equal(config.manifestPath, path.join(root, "docs/traceability.yaml"));
    }));

  test("CLI の設定解決は repo の外を指すリンクを拒否する", async () =>
    fixture(async (root, outside) => {
      await writeFile(path.join(outside, "m.yaml"), MANIFEST);
      await symlink(path.join(outside, "m.yaml"), path.join(root, "docs/traceability.yaml"));
      assert.throws(
        () => discoverConfig({ root, manifest: path.join(root, "docs/traceability.yaml") }),
        /outside the repository root/,
      );
    }));

  test("ライブラリの update も repo の外を指すリンクを辿って書き込まない", async () =>
    fixture(async (root, outside) => {
      const external = path.join(outside, "m.yaml");
      await writeFile(external, MANIFEST);
      await symlink(external, path.join(root, "traceability.yaml"));
      await assert.rejects(
        updateManifestHashes(path.join(root, "traceability.yaml"), root),
        /outside the repository root/,
      );
      assert.equal(await readFile(external, "utf8"), MANIFEST);
    }));

  test("ライブラリの update は repo 外の manifest パスを拒否する", async () =>
    fixture(async (root, outside) => {
      const external = path.join(outside, "m.yaml");
      await writeFile(external, MANIFEST);
      await assert.rejects(updateManifestHashes(external, root), /outside the repository root/);
      assert.equal(await readFile(external, "utf8"), MANIFEST);
    }));

  test("リンク切れの manifest へは書き込まない", async () =>
    fixture(async (root) => {
      const link = path.join(root, "docs/traceability.yaml");
      await symlink("../shared/missing.yaml", link);
      await assert.rejects(saveManifest(link, { version: 1, links: [] }), /regular file/);
      assert.ok((await lstat(link)).isSymbolicLink());
      await assert.rejects(lstat(path.join(root, "shared/missing.yaml")), { code: "ENOENT" });
    }));
});
