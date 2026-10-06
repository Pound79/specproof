import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { computeFileHash } from "../hash.js";
import { loadManifest, saveManifest } from "../manifest.js";
import { updateManifestHashes } from "../update.js";

const fixture = async (run: (root: string, file: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "manifest-persistence-"));
  try { await run(root, path.join(root, "traceability.yaml")); }
  finally { await rm(root, { recursive: true, force: true }); }
};

const yaml = (hash: string): string => `# スキーマの説明を消さない\nversion: 1\n# link の説明\nlinks:\n  - id: example\n    label: "例" # 表示名\n    criteria: [AC-1]\n    extension: keep-me\n    spec: []\n    impl:\n      - path: impl.txt\n        hash: '${hash}' # 承認済み\n    features: []\n`;

test("変更ゼロの update はコメント・バイト列・mtime を変えない", async () => fixture(async (root, file) => {
  await writeFile(path.join(root, "impl.txt"), "unchanged\n");
  const raw = yaml(await computeFileHash(path.join(root, "impl.txt")));
  await writeFile(file, raw);
  const before = await stat(file);
  assert.deepEqual((await updateManifestHashes(file, root)).changes, []);
  assert.equal(await readFile(file, "utf8"), raw);
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
}));

test("変更時も hash 以外のコメント・引用符・拡張キーを保存する", async () => fixture(async (root, file) => {
  await writeFile(path.join(root, "impl.txt"), "changed\n");
  const raw = yaml("PENDING");
  await writeFile(file, raw);
  const result = await updateManifestHashes(file, root);
  assert.equal(result.changes.length, 1);
  assert.equal(await readFile(file, "utf8"), raw.replace("'PENDING'", `'${await computeFileHash(path.join(root, "impl.txt"))}'`));
}));

test("dry-run と存在しない参照では説明を含む manifest を変更しない", async () => fixture(async (root, file) => {
  const raw = yaml("PENDING");
  await writeFile(file, raw);
  await assert.rejects(updateManifestHashes(file, root), /file missing/);
  assert.equal(await readFile(file, "utf8"), raw);
  await writeFile(path.join(root, "impl.txt"), "changed\n");
  assert.equal((await updateManifestHashes(file, root, { dryRun: true })).changes.length, 1);
  assert.equal(await readFile(file, "utf8"), raw);
}));

test("読み取り後のユーザー編集を保存で上書きしない", async () => fixture(async (_root, file) => {
  await writeFile(file, yaml("PENDING"));
  const original = await loadManifest(file);
  const updated = structuredClone(original);
  updated.links[0].impl[0].hash = "changed";
  const edited = yaml("PENDING") + "# 同時編集\n";
  await writeFile(file, edited);
  await assert.rejects(saveManifest(file, updated, original), /changed during update/);
  assert.equal(await readFile(file, "utf8"), edited);
}));

test("alias の共有値を意図せず変える更新は拒否する", async () => fixture(async (_root, file) => {
  const raw = yaml("PENDING").replace("hash: 'PENDING'", "hash: &hash 'PENDING'") + "extensionHash: *hash\n";
  await writeFile(file, raw);
  const original = await loadManifest(file);
  const updated = structuredClone(original);
  updated.links[0].impl[0].hash = "changed";
  await assert.rejects(saveManifest(file, updated, original), /hashes only/);
  assert.equal(await readFile(file, "utf8"), raw);
}));
