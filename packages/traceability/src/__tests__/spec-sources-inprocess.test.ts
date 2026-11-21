import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordSpecSource } from "../spec-source-record.js";
import { specSourceWarnings } from "../spec-source-warnings.js";
import {
  checkSpecSources,
  readSourceToRecord,
  readSpecSources,
  type SpecSource,
} from "../spec-sources.js";

// CLI のテスト（spec-sources.test.ts）と同じ場面を、ライブラリを直接呼んで確かめる。
const git = (cwd: string, args: string[]): string =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=specproof-test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } },
  ).trim();

const commitAll = (cwd: string, message: string): string => {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
};

describe("readSpecSources（設定の検査）", () => {
  const read = (value: unknown) => readSpecSources(value, "specproof.config.yaml");
  const valid = { name: "permissions", repo: "../source", ref: "origin/develop" };

  it("省略は空。正しい項目は既定値を補って読む", () => {
    expect(read(undefined)).toEqual([]);
    expect(read(null)).toEqual([]);
    expect(
      read([{ ...valid, paths: ["master/", "a/b"], specDir: "docs", importCommand: "x.sh" }]),
    ).toEqual([{ ...valid, paths: ["master", "a/b"], specDir: "docs", importCommand: "x.sh" }]);
    expect(read([{ ...valid, paths: [".", "master"] }])[0].paths).toEqual([]);
    expect(read([{ ...valid, paths: ["..foo"] }])[0].paths).toEqual(["..foo"]);
  });

  it.each([
    ["配列でない", { a: 1 }, /must be an array/],
    ["項目が mapping でない", ["x"], /must be a mapping/],
    ["名前の形", [{ ...valid, name: "bad name" }], /\.name must be/],
    ["名前の重複", [valid, valid], /duplicated/],
    ["repo が空", [{ ...valid, repo: "" }], /\.repo must be/],
    ["repo に制御文字", [{ ...valid, repo: "a\nb" }], /\.repo must be/],
    ["オプションに見える ref", [{ ...valid, ref: "--output=x" }], /\.ref must be/],
    ["reflog の式", [{ ...valid, ref: "main@{1}" }], /\.ref must be/],
    ["範囲の式", [{ ...valid, ref: "a..b" }], /\.ref must be/],
    [".lock で終わる ref", [{ ...valid, ref: "main.lock" }], /\.ref must be/],
    ["paths が配列でない", [{ ...valid, paths: "x" }], /\.paths must be/],
    ["paths の外", [{ ...valid, paths: ["../x"] }], /\.paths must be/],
    ["paths の絶対パス", [{ ...valid, paths: ["/x"] }], /\.paths must be/],
    ["specDir が空", [{ ...valid, specDir: "" }], /\.specDir must be/],
    ["importCommand が数値", [{ ...valid, importCommand: 1 }], /\.importCommand must be/],
    [
      "件数の上限",
      Array.from({ length: 33 }, (_, i) => ({ ...valid, name: `s${i}` })),
      /at most 32/,
    ],
  ])("%s は止める", (_label, value, message) => {
    expect(() => read(value)).toThrow(message);
  });
});

describe("取り込み元の確かめと記録（ライブラリ）", () => {
  let base: string;
  let root: string;
  let sourceDir: string;
  const source = (fields: Partial<SpecSource> = {}): SpecSource => ({
    name: "permissions",
    repo: "../source",
    ref: "develop",
    paths: ["master"],
    ...fields,
  });

  beforeEach(() => {
    base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "specproof-spec-sources-lib-")));
    root = path.join(base, "e2e");
    sourceDir = path.join(base, "source");
    mkdirSync(root, { recursive: true });
    mkdirSync(path.join(sourceDir, "master"), { recursive: true });
    git(sourceDir, ["init", "-q"]);
    writeFileSync(path.join(sourceDir, "master", "p.yml"), "a\n");
    writeFileSync(path.join(sourceDir, "top.md"), "top\n");
    commitAll(sourceDir, "v1");
    git(sourceDir, ["branch", "develop"]);
    writeFileSync(path.join(root, "traceability.yaml"), "version: 1\nlinks: []\n");
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const advance = (file: string, content: string): string => {
    git(sourceDir, ["switch", "-q", "develop"]);
    writeFileSync(path.join(sourceDir, file), content);
    const commit = commitAll(sourceDir, "change");
    git(sourceDir, ["switch", "-q", "main"]);
    return commit;
  };

  it("状態を current・outdated・path-missing・unrecorded・unavailable に分ける", async () => {
    const recorded = git(sourceDir, ["rev-parse", "develop"]);
    expect(await checkSpecSources(root, [source()], {})).toEqual([
      { name: "permissions", status: "unrecorded" },
    ]);
    expect((await checkSpecSources(root, [source()], { permissions: recorded }))[0].status).toBe(
      "current",
    );
    advance("top.md", "changed\n");
    expect((await checkSpecSources(root, [source()], { permissions: recorded }))[0].status).toBe(
      "current",
    );
    expect(
      (await checkSpecSources(root, [source({ paths: [] })], { permissions: recorded }))[0].status,
    ).toBe("outdated");
    advance("master/p.yml", "b\n");
    expect((await checkSpecSources(root, [source()], { permissions: recorded }))[0].status).toBe(
      "outdated",
    );
    const missing = await checkSpecSources(root, [source({ paths: ["nope"] })], {
      permissions: recorded,
    });
    expect(missing[0]).toMatchObject({ status: "path-missing", missingPaths: ["nope"] });
    expect(
      (await checkSpecSources(root, [source({ ref: "no-such" })], { permissions: recorded }))[0]
        .status,
    ).toBe("unavailable");
    expect(
      (await checkSpecSources(root, [source()], { permissions: "f".repeat(40) }))[0].status,
    ).toBe("unavailable");
    expect(
      (await checkSpecSources(root, [source({ repo: "../nowhere" })], { permissions: recorded }))[0]
        .status,
    ).toBe("unavailable");
    // プロトタイプのキーに見える名前は、記録が無ければ unrecorded。
    expect((await checkSpecSources(root, [source({ name: "toString" })], {}))[0].status).toBe(
      "unrecorded",
    );
  });

  it("ルートでない・.git がシンボリックリンク・commondir がある・部分 clone の取り込み元は読まない", async () => {
    expect(await readSourceToRecord(root, source({ repo: "../source/master" }))).toBeUndefined();
    const linked = path.join(base, "linked");
    mkdirSync(linked);
    symlinkSync(path.join(sourceDir, ".git"), path.join(linked, ".git"));
    expect(await readSourceToRecord(root, source({ repo: "../linked" }))).toBeUndefined();
    writeFileSync(path.join(sourceDir, ".git", "commondir"), "../other\n");
    expect(await readSourceToRecord(root, source())).toBeUndefined();
    rmSync(path.join(sourceDir, ".git", "commondir"));
    git(sourceDir, ["config", "remote.origin.promisor", "true"]);
    expect(await readSourceToRecord(root, source())).toBeUndefined();
    git(sourceDir, ["config", "remote.origin.promisor", "false"]);
    const read = await readSourceToRecord(root, source());
    expect(read).toMatchObject({
      commit: git(sourceDir, ["rev-parse", "develop"]),
      missingPaths: [],
    });
    expect(read?.repoPath).toBe(sourceDir);
    expect((await readSourceToRecord(root, source({ paths: ["nope"] })))?.missingPaths).toEqual([
      "nope",
    ]);
  });

  it("記録の前に、HEAD と ref で paths の中身を比べ、違うパスを返す", async () => {
    const develop = git(sourceDir, ["rev-parse", "develop"]);
    // HEAD が ref と同じコミット。
    expect(await readSourceToRecord(root, source())).toMatchObject({
      head: develop,
      headMismatch: [],
    });
    // HEAD を別のブランチに移し、paths の外だけ変える: 中身は同じ。
    git(sourceDir, ["switch", "-q", "-c", "topic"]);
    writeFileSync(path.join(sourceDir, "top.md"), "changed\n");
    const topic = commitAll(sourceDir, "outside");
    expect(await readSourceToRecord(root, source())).toMatchObject({
      commit: develop,
      head: topic,
      headMismatch: [],
    });
    // paths を省くとツリー全体で比べる。
    expect((await readSourceToRecord(root, source({ paths: [] })))?.headMismatch).toEqual(["."]);
    // paths の中を変える。
    writeFileSync(path.join(sourceDir, "master", "p.yml"), "b\n");
    commitAll(sourceDir, "inside");
    expect((await readSourceToRecord(root, source()))?.headMismatch).toEqual(["master"]);
    // HEAD を解決できない（unborn）ときは全部を違うとし、head を返さない。
    git(sourceDir, ["switch", "-q", "--orphan", "empty"]);
    const unborn = await readSourceToRecord(root, source({ paths: ["master", "top.md"] }));
    expect(unborn?.head).toBeUndefined();
    expect(unborn?.headMismatch).toEqual(["master", "top.md"]);
    expect((await readSourceToRecord(root, source({ paths: [] })))?.headMismatch).toEqual(["."]);
  });

  it("manifest に記録し、記録し直し、ほかの名前を同じ mapping に足す", async () => {
    const manifestPath = path.join(root, "traceability.yaml");
    const first = "a".repeat(40);
    const second = "b".repeat(40);
    expect(await recordSpecSource(manifestPath, root, "permissions", first)).toEqual({});
    expect(await recordSpecSource(manifestPath, root, "permissions", second)).toEqual({
      previous: first,
    });
    await recordSpecSource(manifestPath, root, "2024", first);
    expect(readFileSync(manifestPath, "utf8")).toBe(
      `version: 1\nlinks: []\nspecSources:\n  "permissions": "${second}"\n  "2024": "${first}"\n`,
    );
    const before = readFileSync(manifestPath, "utf8");
    await recordSpecSource(manifestPath, root, "dry", first, { dryRun: true });
    expect(readFileSync(manifestPath, "utf8")).toBe(before);
  });

  it("中身が同じでも、通常のファイルとシンボリックリンクの違い（mode）を変化として扱う", async () => {
    // 通常のファイルの中身と、シンボリックリンクの指す先の文字列が同じなら、git の blob の id は同じになる。
    writeFileSync(path.join(sourceDir, "master", "link.txt"), "target");
    commitAll(sourceDir, "regular file");
    git(sourceDir, ["branch", "-f", "develop"]);
    const recorded = git(sourceDir, ["rev-parse", "develop"]);
    const paths = ["master/link.txt"];
    expect(
      (await checkSpecSources(root, [source({ paths })], { permissions: recorded }))[0].status,
    ).toBe("current");
    git(sourceDir, ["switch", "-q", "develop"]);
    rmSync(path.join(sourceDir, "master", "link.txt"));
    symlinkSync("target", path.join(sourceDir, "master", "link.txt"));
    commitAll(sourceDir, "symlink with the same content");
    git(sourceDir, ["switch", "-q", "main"]);
    expect(
      (await checkSpecSources(root, [source({ paths })], { permissions: recorded }))[0].status,
    ).toBe("outdated");
  });

  it("中身が同じでも、実行ビットの付け外し（mode）を変化として扱う", async () => {
    const recorded = git(sourceDir, ["rev-parse", "develop"]);
    const paths = ["master/p.yml"];
    git(sourceDir, ["switch", "-q", "develop"]);
    chmodSync(path.join(sourceDir, "master", "p.yml"), 0o755);
    git(sourceDir, ["add", "--chmod=+x", "master/p.yml"]);
    git(sourceDir, ["commit", "-q", "-m", "executable"]);
    git(sourceDir, ["switch", "-q", "main"]);
    expect(
      (await checkSpecSources(root, [source({ paths })], { permissions: recorded }))[0].status,
    ).toBe("outdated");
  });

  it("同じ名前のエントリが重複した壊れた tree は、どちらかを選ばずに読めないものとする", async () => {
    const recorded = git(sourceDir, ["rev-parse", "develop"]);
    const blob = git(sourceDir, ["rev-parse", "develop:top.md"]);
    const master = git(sourceDir, ["rev-parse", "develop:master"]);
    // git の tree の形式（"<mode> <name>\0<20 バイトの id>"）で、top.md を 2 回並べる（git は普通には作らない）。
    const entry = (mode: string, name: string, id: string) =>
      Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(id, "hex")]);
    const raw = Buffer.concat([
      entry("40000", "master", master),
      entry("100644", "top.md", blob),
      entry("100644", "top.md", master.replace(/./, "0")),
    ]);
    const tree = execFileSync(
      "git",
      ["hash-object", "-t", "tree", "-w", "--literally", "--stdin"],
      { cwd: sourceDir, input: raw, encoding: "utf8" },
    ).trim();
    const broken = git(sourceDir, ["commit-tree", tree, "-p", recorded, "-m", "duplicated"]);
    git(sourceDir, ["update-ref", "refs/heads/develop", broken]);
    expect(
      (await checkSpecSources(root, [source({ paths: ["top.md"] })], { permissions: recorded }))[0]
        .status,
    ).toBe("unavailable");
  });

  it("記録が上限（256 件）に達していれば、新しい名前は書かずに失敗し、既存の名前は記録し直せる", async () => {
    const manifestPath = path.join(root, "traceability.yaml");
    const full = Array.from({ length: 256 }, (_, i) => `  "s${i}": "${"a".repeat(40)}"`).join("\n");
    writeFileSync(manifestPath, `version: 1\nlinks: []\nspecSources:\n${full}\n`);
    const before = readFileSync(manifestPath, "utf8");
    await expect(recordSpecSource(manifestPath, root, "newest", "b".repeat(40))).rejects.toThrow(
      /at most 256/,
    );
    expect(readFileSync(manifestPath, "utf8")).toBe(before);
    expect(await recordSpecSource(manifestPath, root, "s0", "b".repeat(40))).toEqual({
      previous: "a".repeat(40),
    });
  });

  it("空の specSources: の行・CRLF・コメントを保ち、flow の mapping は拒む", async () => {
    const manifestPath = path.join(root, "traceability.yaml");
    writeFileSync(manifestPath, "version: 1\r\nlinks: []\r\nspecSources: # note\r\n");
    await recordSpecSource(manifestPath, root, "permissions", "a".repeat(40));
    expect(readFileSync(manifestPath, "utf8")).toBe(
      `version: 1\r\nlinks: []\r\nspecSources: # note\r\n  "permissions": "${"a".repeat(40)}"\r\n`,
    );
    writeFileSync(manifestPath, "version: 1\nlinks: []\nspecSources: {}\n");
    await expect(
      recordSpecSource(manifestPath, root, "permissions", "a".repeat(40)),
    ).rejects.toThrow(/block mapping/);
    writeFileSync(manifestPath, "version: 1\nlinks: []");
    await recordSpecSource(manifestPath, root, "p", "a".repeat(40));
    expect(readFileSync(manifestPath, "utf8")).toBe(
      `version: 1\nlinks: []\nspecSources:\n  "p": "${"a".repeat(40)}"\n`,
    );
  });

  it("警告は確かめられたものだけを出し、記録のコマンドを示す", () => {
    const sources = [source({ specDir: "docs" }), source({ name: "glossary", paths: [] })];
    const warnings = specSourceWarnings(sources, [
      {
        name: "permissions",
        status: "outdated",
        recorded: "a".repeat(40),
        current: "b".repeat(40),
      },
      { name: "glossary", status: "unrecorded" },
      { name: "other", status: "outdated" },
      { name: "permissions", status: "unavailable" },
      { name: "permissions", status: "current" },
      {
        name: "glossary",
        status: "path-missing",
        current: "c".repeat(40),
        missingPaths: ["x"],
      },
    ]);
    expect(warnings.map((warning) => warning.kind)).toEqual([
      "spec-source-outdated",
      "spec-source-unrecorded",
      "spec-source-outdated",
    ]);
    expect(warnings[0]).toMatchObject({ path: "docs" });
    expect(warnings[0].message).toMatch(/changes in master/);
    expect(warnings[1].message).toMatch(/--record-spec-source glossary/);
    expect(warnings[2].message).toMatch(/has no "x"/);
  });
});

describe("manifest の specSources の検査", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "specproof-spec-sources-manifest-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const load = async (tail: string) => {
    const { loadManifest } = await import("../manifest.js");
    const file = path.join(dir, "traceability.yaml");
    writeFileSync(file, `version: 1\nlinks: []\n${tail}`);
    return loadManifest(file);
  };

  it("名前からコミットへの mapping だけを受け、空は無いものとして扱う", async () => {
    expect((await load("specSources:\n")).specSources).toBeNull();
    expect((await load(`specSources:\n  "p": "${"a".repeat(40)}"\n`)).specSources).toEqual({
      p: "a".repeat(40),
    });
    await expect(load("specSources: [1]\n")).rejects.toThrow(/specSources must be a mapping/);
    await expect(load('specSources:\n  "bad name": "x"\n')).rejects.toThrow(/full commit id/);
    await expect(load('specSources:\n  "p": "abc"\n')).rejects.toThrow(/full commit id/);
    const many = Array.from({ length: 257 }, (_, i) => `  "s${i}": "${"a".repeat(40)}"`).join("\n");
    await expect(load(`specSources:\n${many}\n`)).rejects.toThrow(/at most 256/);
  });
});
