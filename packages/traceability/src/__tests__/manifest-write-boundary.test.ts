import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test, vi } from "vitest";
import * as hash from "../hash.js";
import { updateManifestHashes } from "../update.js";

const MANIFEST = [
  "version: 1",
  "links:",
  "  - id: a",
  "    label: A",
  "    spec: []",
  "    impl:",
  "      - path: src/a.ts",
  "        hash: PENDING",
  "    features: []",
  "",
].join("\n");

const roots = [
  { name: "物理 root", logical: false },
  { name: "symlink 経由の root", logical: true },
];
const replacements = ["symlink", "file", "directory"] as const;

describe.skipIf(process.platform === "win32")("manifest 保存直前の境界検証", () => {
  describe.each(roots)("$name", ({ logical }) => {
    test.each(replacements)("%s が hash 計算中に外へ差し替わったら拒否する", async (kind) => {
      const temp = await mkdtemp(path.join(os.tmpdir(), "manifest-write-boundary-"));
      try {
        const root = path.join(temp, "repo");
        const outside = path.join(temp, "outside");
        const shared = path.join(root, "shared");
        const docs = path.join(root, "docs");
        const target = path.join(shared, "manifest.yaml");
        const manifest = path.join(docs, "manifest.yaml");
        const external = path.join(outside, "manifest.yaml");
        await mkdir(shared, { recursive: true });
        await mkdir(path.join(root, "src"));
        await mkdir(outside);
        await writeFile(path.join(root, "src/a.ts"), "export {};\n");
        await writeFile(target, MANIFEST);
        // 内容比較だけでは止まらない条件を作る。
        await writeFile(external, MANIFEST);
        if (kind === "directory") {
          await symlink(shared, docs);
        } else {
          await mkdir(docs);
          if (kind === "symlink") await symlink(target, manifest);
          else await writeFile(manifest, MANIFEST);
        }

        const alias = path.join(temp, "repo-link");
        if (logical) await symlink(root, alias);
        const requestedRoot = logical ? alias : root;
        const requestedManifest = path.join(requestedRoot, "docs/manifest.yaml");
        const computeFileHash = hash.computeFileHash;
        const spy = vi.spyOn(hash, "computeFileHash").mockImplementationOnce(async (file) => {
          const value = await computeFileHash(file);
          // update の入口検証と読込の後、保存前に確実に差し替える。
          const replaced = kind === "directory" ? docs : manifest;
          await unlink(replaced);
          await symlink(kind === "directory" ? outside : external, replaced);
          return value;
        });
        try {
          await assert.rejects(
            updateManifestHashes(requestedManifest, requestedRoot),
            /outside the repository root/,
          );
          assert.equal(spy.mock.calls.length, 1);
          assert.equal(await readFile(external, "utf8"), MANIFEST);
          assert.equal(await readFile(target, "utf8"), MANIFEST);
          assert.deepEqual(await readdir(outside), ["manifest.yaml"]);
        } finally {
          spy.mockRestore();
        }
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    });
  });
});
