import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { loadManifest } from "../manifest.js";

// ADR 0010: manifest の version は外部の読み手への契約。specproof が知るより新しい version は、
// 壊れた manifest と区別し、specproof の更新を促して拒否する（新しい版の hash を旧い規則で読んだり
// 取り直したりしない）。
const load = async (content: string) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "specproof-manifest-version-"));
  try {
    const file = path.join(dir, "traceability.yaml");
    writeFileSync(file, content);
    return await loadManifest(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("知るより新しい version は specproof の更新を促して拒否する", async () => {
  await assert.rejects(
    load("version: 2\nlinks: []\n"),
    /manifest version 2 is newer than this specproof supports \(1\).*update @pound79\/specproof-traceability/,
  );
});

for (const version of ["0", "-1", "1.5", '"1"', "null"]) {
  test(`version: ${version} は形の誤りとして拒否する`, async () => {
    await assert.rejects(
      load(`version: ${version}\nlinks: []\n`),
      /expected \{ version: 1, links: \[\.\.\.\] \}/,
    );
  });
}

test("version 1 は従来どおり読む", async () => {
  const manifest = await load("version: 1\nlinks: []\n");
  assert.equal(manifest.version, 1);
});
