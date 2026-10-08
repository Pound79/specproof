import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  decodeContent,
  findTerms,
  parseRawDiff,
  parseTerms,
} from "./githooks/check-private-terms.mjs";

// 実際に git commit / git push を走らせ、記録・送信が起きたかどうかを観測して判定する。
// 語彙は架空の語にする（本物の私的な語をここに書くと、それ自体が公開される）。
const hooks = fileURLToPath(new URL("./githooks", import.meta.url));
const TERMS = "# 例\nsecret-app\nTaro Example\n内部案件\n";

const sandbox = (run, { terms = TERMS } = {}) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "private-terms-"));
  try {
    const repo = path.join(dir, "repo");
    const remote = path.join(dir, "remote.git");
    const termsFile = path.join(dir, "terms.txt");
    const globalConfig = path.join(dir, "gitconfig");
    mkdirSync(repo);
    writeFileSync(globalConfig, "");
    if (terms !== null) writeFileSync(termsFile, terms);
    const env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_CONFIG_NOSYSTEM: "1",
      SPECPROOF_PRIVATE_TERMS: termsFile,
      GIT_AUTHOR_NAME: "Pound",
      GIT_AUTHOR_EMAIL: "dev@example.com",
      GIT_COMMITTER_NAME: "Pound",
      GIT_COMMITTER_EMAIL: "dev@example.com",
    };
    const git = (args, extraEnv = {}) =>
      spawnSync("git", args, { cwd: repo, encoding: "utf8", env: { ...env, ...extraEnv } });
    const ok = (args, extraEnv) => {
      const result = git(args, extraEnv);
      assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr}`);
      return result.stdout.trim();
    };
    ok(["init", "-q", "-b", "main"]);
    ok(["init", "-q", "--bare", remote]);
    ok(["remote", "add", "origin", remote]);
    ok(["config", "core.hooksPath", hooks]);
    const write = (name, text) => {
      mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
      writeFileSync(path.join(repo, name), text);
    };
    write("README.md", "base\n");
    ok(["add", "."]);
    ok(["commit", "-q", "-m", "base"]);
    const count = () => Number(ok(["rev-list", "--count", "HEAD"]));
    const remoteHead = () =>
      spawnSync("git", ["rev-parse", "-q", "--verify", "refs/heads/main"], {
        cwd: remote,
        encoding: "utf8",
      }).stdout.trim();
    run({ repoPath: repo, dir, env, git, ok, write, count, remoteHead });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** 変更をステージしてコミットを試み、実際に記録されたかを返す。 */
const tryCommit = ({ git, count }, args, extraEnv) => {
  const before = count();
  const result = git(["commit", "-q", ...args], extraEnv);
  return { recorded: count() === before + 1, stderr: result.stderr };
};

test("語彙の読み込みと照合は大文字小文字と多バイト文字を扱う", () => {
  const terms = parseTerms(TERMS);
  assert.deepEqual(terms, ["secret-app", "Taro Example", "内部案件"]);
  assert.deepEqual(findTerms("see SECRET-APP and taro example", terms), [
    "secret-app",
    "Taro Example",
  ]);
  assert.deepEqual(findTerms("これは内部案件です", terms), ["内部案件"]);
  // macOS のファイル名などに現れる、濁点を分離した NFD 形でも検出する。
  assert.deepEqual(findTerms("ガイド".normalize("NFD"), ["ガイド"]), ["ガイド"]);
  assert.deepEqual(findTerms("ガイド", ["ガイド".normalize("NFD")]), ["ガイド".normalize("NFD")]);
  assert.deepEqual(findTerms("nothing private here", terms), []);
});

test("内容の復号は UTF-16 の BOM を解釈し、それ以外は UTF-8 として読む", () => {
  const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("secret-app", "utf16le")]);
  assert.equal(decodeContent(utf16le), "secret-app");
  const utf16be = Buffer.from(Buffer.from("内部案件", "utf16le")).swap16();
  assert.equal(decodeContent(Buffer.concat([Buffer.from([0xfe, 0xff]), utf16be])), "内部案件");
  assert.equal(decodeContent(Buffer.from("内部案件\0", "utf8")), "内部案件\0");
});

test("raw 形式の差分から新しい blob とパスを読み、gitlink と改名元を区別する", () => {
  const sha = (c) => c.repeat(40);
  const raw = [
    `:000000 100644 ${sha("0")} ${sha("a")} A`,
    "new.md",
    `:100644 100644 ${sha("b")} ${sha("c")} R100`,
    "old-name.md",
    "renamed.md",
    `:000000 160000 ${sha("0")} ${sha("d")} A`,
    "vendor/sub",
    "",
  ].join("\0");
  assert.deepEqual(parseRawDiff(raw), [
    { path: "new.md", blob: sha("a"), gitlink: false },
    { path: "renamed.md", blob: sha("c"), gitlink: false },
    { path: "vendor/sub", blob: sha("d"), gitlink: true },
  ]);
});

test("pre-commit: 私的な語を含まない変更は記録される", () =>
  sandbox((repo) => {
    repo.write("docs/a.md", "public text\n");
    repo.ok(["add", "."]);
    assert.equal(tryCommit(repo, ["-m", "docs: add"]).recorded, true);
  }));

for (const [name, setup] of [
  ["追加行の語（大文字）", (r) => r.write("a.md", "uses SECRET-APP\n")],
  ["追加行の多バイトの語", (r) => r.write("a.md", "これは内部案件の記録\n")],
  ["'++ ' で始まる追加行", (r) => r.write("a.md", "++ secret-app\n")],
  ["ファイル名", (r) => r.write("notes/secret-app.md", "x\n")],
  [
    "git が binary とみなすテキスト",
    (r) => {
      r.write(".git/info/attributes", "*.md -diff\n");
      r.write("a.md", "uses secret-app\n");
    },
  ],
  [
    "UTF-16 のテキスト",
    (r) =>
      r.write(
        "a.txt",
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("uses secret-app\n", "utf16le")]),
      ),
  ],
  [
    "symlink から通常ファイルへの種別変更",
    (r) => {
      symlinkSync("README.md", path.join(r.repoPath, "link"));
      r.ok(["add", "."]);
      r.ok(["commit", "-q", "-m", "add link"]);
      unlinkSync(path.join(r.repoPath, "link"));
      r.write("link", "secret-app here\n");
    },
  ],
  ["リンク先のパス", (r) => symlinkSync("../secret-app/x", path.join(r.repoPath, "link"))],
]) {
  test(`pre-commit: ${name}を含む変更は記録しない`, () =>
    sandbox((repo) => {
      setup(repo);
      repo.ok(["add", "."]);
      const { recorded, stderr } = tryCommit(repo, ["-m", "docs: add"]);
      assert.equal(recorded, false);
      assert.match(stderr, /公開リポジトリに入れない語/);
    }));
}

test("pre-commit: 作者の名義に私的な語があれば記録しない", () =>
  sandbox((repo) => {
    repo.write("a.md", "x\n");
    repo.ok(["add", "."]);
    assert.equal(
      tryCommit(repo, ["-m", "docs: add"], { GIT_AUTHOR_NAME: "Taro Example" }).recorded,
      false,
    );
  }));

test("commit-msg: 本文の語も、-F で残る '#' 行の語も記録しない", () =>
  sandbox((repo) => {
    repo.write("a.md", "x\n");
    repo.ok(["add", "."]);
    assert.equal(tryCommit(repo, ["-m", "docs: secret-app の説明"]).recorded, false);
    const message = path.join(repo.dir, "msg.txt");
    writeFileSync(message, "docs: add\n\n# secret-app\n");
    assert.equal(tryCommit(repo, ["-F", message]).recorded, false);
  }));

test("commit-msg: strip 設定でも scissors 以降に残る語を記録しない", () =>
  sandbox((repo) => {
    repo.write("a.md", "x\n");
    repo.ok(["add", "."]);
    repo.ok(["config", "commit.cleanup", "strip"]);
    const message = path.join(repo.dir, "msg.txt");
    writeFileSync(
      message,
      "docs: add\n\n# secret-app\n# ------------------------ >8 ------------------------\n-secret-app\n",
    );
    assert.equal(tryCommit(repo, ["-F", message]).recorded, false);
  }));

test("語彙ファイルが無ければ検査を省略し、その旨を表示する", () =>
  sandbox(
    (repo) => {
      repo.write("a.md", "secret-app\n");
      repo.ok(["add", "."]);
      const { recorded, stderr } = tryCommit(repo, ["-m", "docs: add"]);
      assert.equal(recorded, true);
      assert.match(stderr, /検査を省略しました/);
    },
    { terms: null },
  ));

test("pre-push: フックを迂回した作者の名義・本文を含むコミットは送らない", () =>
  sandbox((repo) => {
    repo.ok(["push", "-q", "origin", "main"]);
    const before = repo.remoteHead();
    repo.write("a.md", "uses secret-app\n");
    repo.ok(["add", "."]);
    repo.ok(["commit", "-q", "--no-verify", "-m", "docs: add"], {
      GIT_AUTHOR_NAME: "Taro Example",
    });
    const result = repo.git(["push", "-q", "origin", "main"]);
    assert.notEqual(result.status, 0);
    assert.equal(repo.remoteHead(), before);
  }));

test("pre-push: amend で引き継いだ作者の名義も送らない", () =>
  sandbox((repo) => {
    repo.ok(["push", "-q", "origin", "main"]);
    const before = repo.remoteHead();
    repo.write("a.md", "x\n");
    repo.ok(["add", "."]);
    repo.ok(["commit", "-q", "--no-verify", "-m", "docs: add"], {
      GIT_AUTHOR_NAME: "Taro Example",
    });
    // 作者の環境変数を外して amend しても、元の作者名は引き継がれる。
    repo.ok(["commit", "-q", "--amend", "--no-verify", "-m", "docs: add"]);
    assert.notEqual(repo.git(["push", "-q", "origin", "main"]).status, 0);
    assert.equal(repo.remoteHead(), before);
  }));

test("pre-push: 注釈付きタグの本文に語があれば送らない", () =>
  sandbox((repo) => {
    repo.ok(["push", "-q", "origin", "main"]);
    repo.ok(["tag", "-a", "v1.0.0", "-m", "release for 内部案件"]);
    assert.notEqual(repo.git(["push", "-q", "origin", "v1.0.0"]).status, 0);
    const remoteTag = spawnSync("git", ["rev-parse", "-q", "--verify", "refs/tags/v1.0.0"], {
      cwd: path.join(repo.dir, "remote.git"),
      encoding: "utf8",
    });
    assert.notEqual(remoteTag.status, 0);
  }));

test("pre-push: 別のリモートに送ったことのあるコミットも、送り先に未送信なら検査する", () =>
  sandbox((repo) => {
    repo.ok(["push", "-q", "origin", "main"]);
    const privateRemote = path.join(repo.dir, "private.git");
    repo.ok(["init", "-q", "--bare", privateRemote]);
    repo.ok(["remote", "add", "priv", privateRemote]);
    repo.ok(["switch", "-q", "-c", "feat"]);
    repo.write("a.md", "uses secret-app\n");
    repo.ok(["add", "."]);
    repo.ok(["commit", "-q", "--no-verify", "-m", "docs: add"]);
    repo.ok(["push", "-q", "--no-verify", "priv", "feat"]);
    assert.notEqual(repo.git(["push", "-q", "origin", "feat"]).status, 0);
    const remoteFeat = spawnSync("git", ["rev-parse", "-q", "--verify", "refs/heads/feat"], {
      cwd: path.join(repo.dir, "remote.git"),
      encoding: "utf8",
    });
    assert.notEqual(remoteFeat.status, 0);
  }));

test("pre-push: merge で持ち込んだ語も送らない", () =>
  sandbox((repo) => {
    repo.ok(["push", "-q", "origin", "main"]);
    const before = repo.remoteHead();
    repo.ok(["switch", "-q", "-c", "side"]);
    repo.write("side.md", "side\n");
    repo.ok(["add", "."]);
    repo.ok(["commit", "-q", "-m", "side"]);
    repo.ok(["switch", "-q", "main"]);
    repo.ok(["merge", "-q", "--no-ff", "--no-commit", "side"]);
    repo.write("evil.md", "secret-app\n");
    repo.ok(["add", "evil.md"]);
    repo.ok(["commit", "-q", "--no-verify", "-m", "Merge side"]);
    assert.notEqual(repo.git(["push", "-q", "origin", "main"]).status, 0);
    assert.equal(repo.remoteHead(), before);
  }));

test("pre-push: 送り先の SHA を手元に持たない force push でも git のエラーを表示せず全体を検査する", () =>
  sandbox((repo) => {
    // 履歴を書き換えた後の force push では、送り先の旧 SHA が手元に無い。
    const missing = "f".repeat(40);
    const run = (body) => {
      repo.write("a.md", body);
      repo.ok(["add", "."]);
      repo.ok(["commit", "-q", "--no-verify", "-m", "docs: update"]);
      const head = repo.ok(["rev-parse", "HEAD"]);
      return spawnSync(
        process.execPath,
        [path.join(hooks, "check-private-terms.mjs"), "push", "origin"],
        {
          cwd: repo.repoPath,
          env: repo.env,
          encoding: "utf8",
          input: `refs/heads/main ${head} refs/heads/main ${missing}\n`,
        },
      );
    };
    const clean = run("public\n");
    assert.equal(clean.status, 0, clean.stderr);
    assert.equal(clean.stderr, "");
    const leak = run("uses secret-app\n");
    assert.equal(leak.status, 1);
    assert.doesNotMatch(leak.stderr, /fatal:/);
    assert.match(leak.stderr, /公開リポジトリに入れない語/);
  }));

test("pre-push: 私的な語を含まないコミットとタグは送られる", () =>
  sandbox((repo) => {
    repo.write("a.md", "public\n");
    repo.ok(["add", "."]);
    repo.ok(["commit", "-q", "-m", "docs: add"]);
    repo.ok(["tag", "-a", "v1.0.0", "-m", "v1.0.0"]);
    assert.equal(repo.git(["push", "-q", "origin", "main", "v1.0.0"]).status, 0);
    assert.equal(repo.remoteHead(), repo.ok(["rev-parse", "HEAD"]));
  }));
