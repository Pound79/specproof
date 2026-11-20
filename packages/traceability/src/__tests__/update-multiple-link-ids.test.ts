import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { parseCliArgs } from "../cli-args.js";
import { updateManifestHashes } from "../update.js";

// 1 つの変更で多くのリンクが drift したとき、関係を確かめたリンクだけをまとめて bless できるようにする。
// 以前は --link-id を重ねると、黙って最後の 1 つだけが効いていた。

const cli = fileURLToPath(new URL("../../dist/cli-update.js", import.meta.url));

const implLink = (id: string, file: string): string =>
  `  - id: ${id}\n    label: ${id}\n    spec: []\n    impl:\n      - path: ${file}\n        hash: PENDING\n    features: []\n`;

const MANIFEST = `version: 1\nlinks:\n${implLink("a", "a.ts")}${implLink("b", "b.ts")}${implLink("c", "c.ts")}`;

const withRepo = <T>(run: (root: string) => T): T => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-update-ids-"));
  try {
    for (const name of ["a", "b", "c"]) {
      writeFileSync(path.join(root, `${name}.ts`), `export const ${name} = 1;\n`);
    }
    writeFileSync(path.join(root, "traceability.yaml"), MANIFEST);
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const runUpdate = (root: string, args: string[]) => {
  const result = spawnSync(process.execPath, [cli, "--root", root, ...args], {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  return result;
};

test("--link-id を重ねると、指定したリンクをすべて更新し、ほかのリンクは変えない", () => {
  withRepo((root) => {
    const result = runUpdate(root, ["--link-id", "a", "--link-id", "b"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^a impl a\.ts: PENDING -> /m);
    assert.match(result.stdout, /^b impl b\.ts: PENDING -> /m);
    assert.doesNotMatch(result.stdout, /^c impl/m);
    assert.match(
      result.stdout,
      /manifest updated: links "a", "b" refreshed \(2 hash\(es\) changed\)/,
    );
    const saved = readFileSync(path.join(root, "traceability.yaml"), "utf8");
    assert.equal(saved.match(/hash: PENDING/g)?.length, 1, "c だけが PENDING のまま残る");
  });
});

test("同じ id を重ねても 1 つとして扱う", () => {
  withRepo((root) => {
    const result = runUpdate(root, ["--link-id", "a", "--link-id", "a"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /manifest updated: link "a" refreshed \(1 hash\(es\) changed\)/);
  });
});

test("重ねた id に manifest に無いものが 1 つでもあれば、何も書かずに失敗し、無い id をすべて示す", () => {
  withRepo((root) => {
    const before = readFileSync(path.join(root, "traceability.yaml"), "utf8");
    const result = runUpdate(root, ["--link-id", "a", "--link-id", "x", "--link-id", "y"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no link with id "x", "y"/);
    assert.equal(readFileSync(path.join(root, "traceability.yaml"), "utf8"), before);
  });
});

test("parseCliArgs は --link-id を重ねた順に集め、ほかの値のオプションは従来どおり 1 つ", () => {
  const parsed = parseCliArgs(["--link-id", "a", "--link-id", "-b"], "update");
  assert.deepEqual(parsed.linkIds, ["a", "-b"]);
});

test("updateManifestHashes は linkIds と従来の linkId を合わせた集合を更新する", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-update-ids-api-"));
  try {
    for (const name of ["a", "b", "c"]) {
      writeFileSync(path.join(root, `${name}.ts`), `export const ${name} = 1;\n`);
    }
    const manifestPath = path.join(root, "traceability.yaml");
    writeFileSync(manifestPath, MANIFEST);
    const result = await updateManifestHashes(manifestPath, root, {
      linkId: "a",
      linkIds: ["c"],
      dryRun: true,
    });
    assert.deepEqual(
      result.changes.map((change) => change.linkId),
      ["a", "c"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("未知の id は --dry-run でも失敗する", () => {
  withRepo((root) => {
    const result = runUpdate(root, ["--link-id", "a", "--link-id", "x", "--dry-run"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no link with id "x"/);
  });
});

test("id の引用は JSON の文字列にし、id に入った引用符で一覧を偽装させない", () => {
  withRepo((root) => {
    const result = runUpdate(root, ["--link-id", 'x", "y']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no link with id "x\\", \\"y" in/);
  });
});

test("updateManifestHashes に空の linkIds を渡すと、全リンクを更新せずに失敗する", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "specproof-update-ids-empty-"));
  try {
    for (const name of ["a", "b", "c"]) {
      writeFileSync(path.join(root, `${name}.ts`), `export const ${name} = 1;\n`);
    }
    const manifestPath = path.join(root, "traceability.yaml");
    writeFileSync(manifestPath, MANIFEST);
    await assert.rejects(
      updateManifestHashes(manifestPath, root, { linkIds: [] }),
      /linkIds is empty/,
    );
    assert.equal(readFileSync(manifestPath, "utf8"), MANIFEST);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
