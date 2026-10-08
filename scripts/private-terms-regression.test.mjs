import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const hooks = fileURLToPath(new URL("./githooks", import.meta.url));
// 語彙は架空のものだけを使い、送信先はネットワークに接続しない bare repository にする。
const sandbox = (run) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "private-push-"));
  try {
    const repo = path.join(dir, "repo");
    const remote = path.join(dir, "remote.git");
    const termsFile = path.join(dir, "terms.txt");
    const globalConfig = path.join(dir, "gitconfig");
    mkdirSync(repo);
    writeFileSync(termsFile, "secret-app\n");
    writeFileSync(globalConfig, "");
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
    const git = (args, input) =>
      spawnSync("git", args, { cwd: repo, env, input, encoding: "utf8" });
    const ok = (args, input) => {
      const result = git(args, input);
      assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr}`);
      return result.stdout.trim();
    };
    const remoteRef = (ref) =>
      spawnSync("git", ["rev-parse", "--verify", ref], {
        cwd: remote, env, encoding: "utf8",
      });
    ok(["init", "-q", "-b", "main"]);
    ok(["init", "-q", "--bare", remote]);
    ok(["remote", "add", "origin", remote]);
    ok(["config", "core.hooksPath", hooks]);
    writeFileSync(path.join(repo, "README.md"), "public\n");
    ok(["add", "."]);
    ok(["commit", "-q", "-m", "base"]);
    ok(["push", "-q", "origin", "main"]);
    const blocked = (refspec, remoteName) => {
      const before = remoteRef("refs/heads/main").stdout;
      const result = git(["push", "-q", "origin", refspec]);
      assert.notEqual(result.status, 0, "私的な語を含む ref を送信してはならない");
      assert.match(result.stderr, /公開リポジトリに入れない語/);
      assert.notEqual(remoteRef(remoteName).status, 0, "送り先に ref を作成してはならない");
      assert.equal(remoteRef("refs/heads/main").stdout, before);
    };
    run({ repo, dir, git, ok, remoteRef, blocked });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

for (const kind of ["heads", "tags"]) {
  test(`pre-push: 既存コミットに付けた私的な ${kind} 名を送らない`, () =>
    sandbox(({ ok, blocked }) => {
      const ref = `refs/${kind}/secret-app`;
      ok(["update-ref", ref, "HEAD"]);
      blocked(ref, ref);
    }));

  test(`pre-push: refspec で指定した送り先の私的な ${kind} 名を送らない`, () =>
    sandbox(({ blocked }) => {
      const ref = `refs/${kind}/secret-app`;
      blocked(`HEAD:${ref}`, ref);
    }));
}

test("pre-push: 公開されないローカルの ref 名だけでは拒否しない", () =>
  sandbox(({ ok, remoteRef }) => {
    ok(["branch", "secret-app"]);
    ok(["push", "-q", "origin", "secret-app:refs/heads/public-branch"]);
    assert.equal(remoteRef("refs/heads/public-branch").stdout.trim(), ok(["rev-parse", "HEAD"]));
  }));

test("pre-push: 私的な ref 名の削除は妨げない", () =>
  sandbox(({ ok, remoteRef }) => {
    ok(["push", "-q", "--no-verify", "origin", "HEAD:refs/tags/secret-app"]);
    ok(["push", "-q", "origin", ":refs/tags/secret-app"]);
    assert.notEqual(remoteRef("refs/tags/secret-app").status, 0);
  }));

test("pre-push: 多段の注釈付きタグの内側にある本文も送らない", () =>
  sandbox(({ ok, blocked }) => {
    ok(["tag", "-a", "inner", "-m", "release for secret-app"]);
    ok(["tag", "-a", "outer", "inner", "-m", "public release"]);
    blocked("refs/tags/outer", "refs/tags/outer");
  }));

test("pre-push: 多段の注釈付きタグの内側にあるタグ名も送らない", () =>
  sandbox(({ ok, blocked }) => {
    ok(["tag", "-a", "secret-app", "-m", "public release"]);
    ok(["tag", "-a", "outer", "secret-app", "-m", "public release"]);
    blocked("refs/tags/outer", "refs/tags/outer");
  }));

for (const annotated of [false, true]) {
  test(`pre-push: blob を直接指す${annotated ? "注釈付き" : "軽量"}タグの内容も送らない`, () =>
    sandbox(({ ok, blocked }) => {
      const blob = ok(["hash-object", "-w", "--stdin"], "uses secret-app\n");
      ok(annotated
        ? ["tag", "-a", "payload", blob, "-m", "public release"]
        : ["tag", "payload", blob]);
      blocked("refs/tags/payload", "refs/tags/payload");
    }));
}

for (const [file, content] of [["note.md", "secret-app\n"], ["secret-app.md", "public\n"]]) {
  test(`pre-push: tree タグ内の ${file} のパスと内容を検査する`, () =>
    sandbox(({ ok, blocked }) => {
      const blob = ok(["hash-object", "-w", "--stdin"], content);
      const inner = ok(["mktree"], `100644 blob ${blob}\t${file}\n`);
      const tree = ok(["mktree"], `040000 tree ${inner}\tdocs\n`);
      ok(["tag", "payload", tree]);
      blocked("refs/tags/payload", "refs/tags/payload");
    }));
}

test("pre-push: 問題のない多段タグ・blob タグ・tree タグは送られる", () =>
  sandbox(({ ok, remoteRef }) => {
    ok(["tag", "-a", "inner", "-m", "public release"]);
    ok(["tag", "-a", "outer", "inner", "-m", "public release"]);
    const blob = ok(["hash-object", "-w", "--stdin"], "public payload\n");
    const tree = ok(["mktree"], `100644 blob ${blob}\tnote.md\n`);
    ok(["tag", "blob", blob]);
    ok(["tag", "tree", tree]);
    ok(["push", "-q", "origin", "outer", "blob", "tree"]);
    for (const tag of ["outer", "blob", "tree"]) {
      assert.equal(remoteRef(`refs/tags/${tag}`).stdout.trim(), ok(["rev-parse", tag]));
    }
  }));

for (const [cleanup, args, text] of [
  ["strip", [], "public\n\n# ------------------------ >8 ------------------------\nsecret-app\n"],
  ["scissors", [], "public\n\n# secret-app\n"],
  ["strip", ["--cleanup=verbatim"], "public\n\n# secret-app\n"],
]) {
  test(`commit-msg: ${cleanup} ${args.join(" ")} で残る語を記録しない`, () =>
    sandbox(({ dir, git, ok }) => {
      ok(["config", "commit.cleanup", cleanup]);
      const before = ok(["rev-parse", "HEAD"]);
      const file = path.join(dir, "message.txt");
      writeFileSync(file, text);
      const result = git(["commit", "-q", "--allow-empty", "-F", file, ...args]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /公開リポジトリに入れない語/);
      assert.equal(ok(["rev-parse", "HEAD"]), before);
    }));
}
