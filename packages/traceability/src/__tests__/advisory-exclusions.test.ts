import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, test } from "vitest";

const checkCli = fileURLToPath(new URL("../../dist/cli-check.js", import.meta.url));
const updateCli = fileURLToPath(new URL("../../dist/cli-update.js", import.meta.url));

const run = (cli: string, cwd: string, args: string[] = []) => {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  return result;
};

const MANIFEST = `version: 1
links:
  - id: perm
    label: Permissions
    spec:
      - path: docs/spec/perm.md
        heading: "Invite a member"
        hash: PENDING
      - path: docs/spec/roles.md
        heading: "Owner can invite"
        hash: PENDING
    impl:
      - path: src/perm.ts
        hash: PENDING
    features: []
`;

const SPEC_PERM = "# Perm\n\n## Invite a member\n\nOwner only.\n\n## Revision history\n\n- v1\n";
const SPEC_ROLES =
  "# Roles\n\n## Owner can invite\n\nYes.\n\n## Roles\n\nOwner, Member.\n\n## Conditions\n\nNone.\n";

const write = (root: string, rel: string, content: string): void => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
};

const config = (extra: string): string =>
  `layout:\n  manifest: traceability.yaml\n  implGlobs:\n    - "src/**/*.ts"\n${extra}`;

const kinds = (stdout: string, kind: string): string[] =>
  JSON.parse(stdout)
    .warnings.filter((warning: { kind: string }) => warning.kind === kind)
    .map((warning: { path: string; message: string }) => warning.message);

// 未登録の実装・見出しの advisory を、テストファイルや操作でない構成の見出しで埋めさせない。
describe("advisory の除外（layout.implExcludeGlobs / layout.specHeadingIgnore）", () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "specproof-advisory-")));
    write(root, "docs/spec/perm.md", SPEC_PERM);
    write(root, "docs/spec/roles.md", SPEC_ROLES);
    write(root, "src/perm.ts", "export {};\n");
    write(root, "src/other.ts", "export {};\n");
    write(root, "src/__tests__/perm.test.ts", "export {};\n");
    write(root, "traceability.yaml", MANIFEST);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("未設定なら、これまでどおりすべて出す", () => {
    write(root, "specproof.config.yaml", config(""));
    assert.equal(run(updateCli, root).status, 0);
    const result = run(checkCli, root, ["--json"]);
    assert.equal(kinds(result.stdout, "unregistered-impl").length, 2);
    assert.equal(kinds(result.stdout, "unregistered-spec-heading").length, 3);
    assert.equal("excludedAdvisories" in JSON.parse(result.stdout), false);
  });

  test("implExcludeGlobs に当たる実装は unregistered-impl に出さず、外した件数を示す", () => {
    write(root, "specproof.config.yaml", config('  implExcludeGlobs:\n    - "**/__tests__/**"\n'));
    assert.equal(run(updateCli, root).status, 0);
    const json = run(checkCli, root, ["--json"]).stdout;
    assert.deepEqual(kinds(json, "unregistered-impl"), [
      "implementation file is not registered in the traceability manifest: src/other.ts",
    ]);
    assert.deepEqual(JSON.parse(json).excludedAdvisories, {
      unregisteredImpl: 1,
      unregisteredSpecHeading: 0,
    });
    const text = run(checkCli, root).stdout;
    assert.match(text, /excluded 1 unregistered-impl .*layout\.implExcludeGlobs/);
  });

  test("specHeadingIgnore はファイル全体（path）か見出し単位（path#見出し）で外す", () => {
    write(
      root,
      "specproof.config.yaml",
      config(
        '  specHeadingIgnore:\n    - "docs/spec/roles.md#Roles"\n    - "docs/spec/roles.md #Conditions"\n    - "docs/spec/perm.md#Revision history"\n',
      ),
    );
    assert.equal(run(updateCli, root).status, 0);
    const json = run(checkCli, root, ["--json"]).stdout;
    assert.deepEqual(kinds(json, "unregistered-spec-heading"), []);
    assert.equal(JSON.parse(json).excludedAdvisories.unregisteredSpecHeading, 3);

    write(
      root,
      "specproof.config.yaml",
      config('  specHeadingIgnore:\n    - "docs/spec/roles.md"\n'),
    );
    const fileWide = run(checkCli, root, ["--json"]).stdout;
    assert.deepEqual(kinds(fileWide, "unregistered-spec-heading"), [
      'spec heading is not registered in the manifest: "Revision history" in docs/spec/perm.md',
    ]);
  });

  test("外すのは未登録の見出しの advisory だけで、登録済みの見出しの drift は外さない", () => {
    write(
      root,
      "specproof.config.yaml",
      config('  specHeadingIgnore:\n    - "docs/spec/roles.md"\n'),
    );
    assert.equal(run(updateCli, root).status, 0);
    write(root, "docs/spec/roles.md", SPEC_ROLES.replace("Yes.", "No."));
    const result = run(checkCli, root, ["--json"]);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).entries[0].path, "docs/spec/roles.md");
  });

  test("型が違えばエラーで止める", () => {
    write(root, "specproof.config.yaml", config('  implExcludeGlobs: "**/__tests__/**"\n'));
    const result = run(checkCli, root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /layout\.implExcludeGlobs/);
  });
});
