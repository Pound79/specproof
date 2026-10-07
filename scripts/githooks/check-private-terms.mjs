#!/usr/bin/env node
// 公開 OSS に私的な名前（下流の個人プロジェクト名・本名・勤務先など）を入れないための検査。
// 語彙はリポジトリの外に置く（ここに書くとそれ自体が公開されるため）:
//   $SPECPROOF_PRIVATE_TERMS、未設定なら ${XDG_CONFIG_HOME:-~/.config}/git/private-terms.txt
// 1 行 1 語。空行と `#` で始まる行は無視し、大文字小文字を区別せず固定文字列で照合する。
//
// scripts/githooks の各フックから呼ぶ:
//   staged          pre-commit: ステージした追加行・ファイル名・作者/committer の名義
//   message <file>  commit-msg: コミットメッセージ（git の cleanup 設定に従う）
//   push            pre-push:   送るコミットの名義・メッセージ・追加行・ファイル名と注釈付きタグ。
//                   amend / rebase / cherry-pick で引き継いだ名義や verbatim のメッセージも
//                   ここで止める最終関門。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const ZERO = /^0+$/;

export const termsFile = (env = process.env) =>
  env.SPECPROOF_PRIVATE_TERMS ||
  path.join(env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "git", "private-terms.txt");

export const parseTerms = (text) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

/** text に含まれる語を返す。 */
export const findTerms = (text, terms) => {
  const haystack = text.toLowerCase();
  return terms.filter((term) => haystack.includes(term.toLowerCase()));
};

/**
 * unified diff の追加行。見出し（diff/---/+++）と hunk を状態で区別するので、
 * 内容が "++ " で始まる追加行（diff 上は "+++ "）も読み落とさない。
 */
export const addedLines = (diff) => {
  const lines = [];
  let file = "";
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    if (!inHunk) {
      if (line.startsWith("+++ ")) file = line.slice(4).replace(/^b\//, "");
      else if (line.startsWith("@@")) inHunk = true;
      continue;
    }
    if (line.startsWith("+")) lines.push({ where: file, text: line.slice(1) });
  }
  return lines;
};

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

const gitConfig = (key) => {
  try {
    return git(["config", "--get", key]).trim();
  } catch {
    return "";
  }
};

const DIFF_OPTIONS = ["--no-color", "--no-ext-diff", "--no-textconv", "-U0", "--diff-filter=ACMR"];

const stagedTargets = () => {
  const targets = ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"].map((variable) => ({
    where: variable,
    text: git(["var", variable]),
  }));
  const names = git(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"]);
  for (const name of names.split("\0").filter(Boolean)) {
    targets.push({ where: `ファイル名 ${name}`, text: name });
  }
  targets.push(...addedLines(git(["diff", "--cached", ...DIFF_OPTIONS])));
  return targets;
};

/** git が確実に捨てるコメント行だけを除き、scissors 以降（commit -v の diff）は見ない。 */
const messageTargets = (file) => {
  const lines = readFileSync(file, "utf8").split("\n");
  const configured = gitConfig("core.commentChar");
  const commentChar = configured && configured !== "auto" ? configured : "#";
  // 既定の cleanup はエディタを開かない -m / -F では "whitespace" になり、コメント行も
  // 記録される。フックからは編集の有無を知れないので、明示的に strip する設定のときだけ除く。
  const cleanup = gitConfig("commit.cleanup");
  const stripsComments = ["strip", "scissors"].includes(cleanup);
  const scissors = lines.findIndex((line) =>
    line.startsWith(`${commentChar} ------------------------ >8 ------------------------`),
  );
  return (scissors === -1 ? lines : lines.slice(0, scissors))
    .filter((line) => !(stripsComments && line.startsWith(commentChar)))
    .map((text) => ({ where: "コミットメッセージ", text }));
};

const commitTargets = (sha) => {
  const label = sha.slice(0, 12);
  const targets = [
    {
      where: `${label} の名義とメッセージ`,
      text: git(["show", "-s", "--format=%an%n%ae%n%cn%n%ce%n%B", sha]),
    },
  ];
  const names = git(["show", "--format=", "--name-only", "-z", "--diff-filter=ACMR", sha]);
  for (const name of names.split("\0").filter(Boolean)) {
    targets.push({ where: `${label} のファイル名 ${name}`, text: name });
  }
  for (const added of addedLines(git(["show", "--format=", ...DIFF_OPTIONS, sha]))) {
    targets.push({ where: `${label} ${added.where}`, text: added.text });
  }
  return targets;
};

/** pre-push の標準入力（ref ごとに "<local ref> <local sha> <remote ref> <remote sha>"）。 */
const pushTargets = (stdin) => {
  const targets = [];
  const seen = new Set();
  for (const line of stdin.split("\n").filter((entry) => entry.trim().length > 0)) {
    const [localRef, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (!localSha || ZERO.test(localSha)) continue; // ref の削除
    if (git(["cat-file", "-t", localSha]).trim() === "tag") {
      targets.push({ where: `タグ ${localRef}`, text: git(["cat-file", "-p", localSha]) });
    }
    const exclude = remoteSha && !ZERO.test(remoteSha) && hasObject(remoteSha)
      ? [`^${remoteSha}`]
      : ["--not", "--remotes"];
    const commits = git(["rev-list", localSha, ...exclude]).split("\n").filter(Boolean);
    for (const sha of commits) {
      if (seen.has(sha)) continue;
      seen.add(sha);
      targets.push(...commitTargets(sha));
    }
  }
  return targets;
};

const hasObject = (sha) => {
  try {
    git(["cat-file", "-e", `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
};

const targetsFor = (mode, arg) => {
  if (mode === "staged") return stagedTargets();
  if (mode === "message" && arg) return messageTargets(arg);
  if (mode === "push") return pushTargets(readFileSync(0, "utf8"));
  return null;
};

const main = () => {
  const [mode, arg] = process.argv.slice(2);
  const file = termsFile();
  if (!existsSync(file)) {
    process.stderr.write(`private-terms: ${file} が無いため私的な語の検査を省略しました\n`);
    return 0;
  }
  const terms = parseTerms(readFileSync(file, "utf8"));
  if (terms.length === 0) {
    process.stderr.write(`private-terms: ${file} に語が無いため検査を省略しました\n`);
    return 0;
  }
  const targets = targetsFor(mode, arg);
  if (targets === null) {
    process.stderr.write("usage: check-private-terms.mjs staged | message <file> | push\n");
    return 2;
  }
  const hits = targets.flatMap(({ where, text }) =>
    findTerms(text, terms).map((term) => `  ${where}: "${term}"`),
  );
  if (hits.length === 0) return 0;
  process.stderr.write(
    `公開リポジトリに入れない語が含まれています（${file}）:\n${[...new Set(hits)].join("\n")}\n`,
  );
  return 1;
};

if (import.meta.main) process.exitCode = main();
