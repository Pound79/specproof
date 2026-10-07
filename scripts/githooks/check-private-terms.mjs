#!/usr/bin/env node
// 公開 OSS に私的な名前（下流の個人プロジェクト名・本名・勤務先など）を入れないための検査。
// 語彙はリポジトリの外に置く（ここに書くとそれ自体が公開されるため）:
//   $SPECPROOF_PRIVATE_TERMS、未設定なら ${XDG_CONFIG_HOME:-~/.config}/git/private-terms.txt
// 1 行 1 語。空行と `#` で始まる行は無視し、大文字小文字を区別せず固定文字列で照合する。
//
// scripts/githooks の各フックから呼ぶ:
//   staged                pre-commit: ステージした各ファイルの内容・パスと作者/committer の名義
//   message <file>        commit-msg: コミットメッセージ（git の cleanup 設定に従う）
//   push <remote name>    pre-push:   送る全コミットの名義・本文・変更ファイルの内容とパス、
//                         注釈付きタグ。amend / rebase で引き継いだ名義や verbatim の
//                         メッセージ、フックを迂回したコミットもここで止める最終関門。
//
// 内容は diff の追加行ではなく、変更された blob 全体を読む。git が binary とみなす
// テキスト（属性や NUL を含む UTF-16）、種別の変更、merge で持ち込んだ内容も漏らさない。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const ZERO = /^0+$/;
const GITLINK_MODE = "160000";
const CHANGED = "--diff-filter=ACMRT";

export const termsFile = (env = process.env) =>
  env.SPECPROOF_PRIVATE_TERMS ||
  path.join(env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "git", "private-terms.txt");

export const parseTerms = (text) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

const normalize = (text) => text.normalize("NFC").toLowerCase();

/** text に含まれる語を返す。NFC に揃え、濁点を分離した NFD 形なども同じ語として扱う。 */
export const findTerms = (text, terms) => {
  const haystack = normalize(text);
  return terms.filter((term) => haystack.includes(normalize(term)));
};

/** UTF-16 の BOM があれば復号し、それ以外は UTF-8 として読む（不正なバイトは置換される）。 */
export const decodeContent = (buffer) => {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return Buffer.from(buffer.subarray(2)).swap16().toString("utf16le");
  }
  return buffer.toString("utf8");
};

/**
 * `git diff --raw -z --no-abbrev` の出力から、変更後の blob とパスを読む。
 * 改名・複製は変更後のパスを採り、gitlink（サブモジュール）は内容を持たないので印を付ける。
 */
export const parseRawDiff = (raw) => {
  const tokens = raw.split("\0");
  const entries = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const meta = tokens[index];
    if (!meta.startsWith(":")) continue;
    const [, newMode, , newBlob, status] = meta.slice(1).split(" ");
    const pathCount = /^[RC]/.test(status) ? 2 : 1;
    const target = tokens[index + pathCount];
    index += pathCount;
    if (target === undefined) break;
    entries.push({ path: target, blob: newBlob, gitlink: newMode === GITLINK_MODE });
  }
  return entries;
};

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

const gitBuffer = (args) =>
  execFileSync("git", args, { maxBuffer: 256 * 1024 * 1024 });

const gitConfig = (key) => {
  try {
    return git(["config", "--get", key]).trim();
  } catch {
    return "";
  }
};

// 検査対象は 1 件ずつ取り出して照合し、内容をためない（全履歴を送るときも
// メモリが履歴の総量に比例して増えないようにする）。

/** 変更されたファイルのパスと内容。同じ blob は一度だけ読む。 */
function* fileTargets(entries, label, seenBlobs) {
  for (const { path: file, blob, gitlink } of entries) {
    yield { where: `${label}ファイル名 ${file}`, text: file };
    if (gitlink || ZERO.test(blob) || seenBlobs.has(blob)) continue;
    seenBlobs.add(blob);
    yield { where: `${label}${file}`, text: decodeContent(gitBuffer(["cat-file", "blob", blob])) };
  }
}

function* stagedTargets() {
  for (const variable of ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"]) {
    yield { where: variable, text: git(["var", variable]) };
  }
  const raw = git(["diff", "--cached", "--raw", "-z", "--no-abbrev", "--no-renames", CHANGED]);
  yield* fileTargets(parseRawDiff(raw), "", new Set());
}

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

function* commitTargets(sha, seenBlobs) {
  const label = `${sha.slice(0, 12)} `;
  yield {
    where: `${label}の名義とメッセージ`,
    text: git(["show", "-s", "--format=%an%n%ae%n%cn%n%ce%n%B", sha]),
  };
  // -m で merge は各親との差分を出す。merge で新たに持ち込んだ blob はどれかの親と異なる。
  const raw = git([
    "diff-tree", "-r", "-m", "--root", "--no-commit-id", "--raw", "-z", "--no-abbrev",
    "--no-renames", CHANGED, sha,
  ]);
  yield* fileTargets(parseRawDiff(raw), label, seenBlobs);
}

const hasCommit = (sha) => {
  try {
    git(["cat-file", "-e", `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
};

const isConfiguredRemote = (name) =>
  name !== undefined && git(["remote"]).split("\n").includes(name);

/**
 * pre-push の標準入力（ref ごとに "<local ref> <local sha> <remote ref> <remote sha>"）。
 * 送り先が既に持つコミットだけを除く。別のリモートにあるコミットは送り先には新しいので検査する。
 */
function* pushTargets(stdin, remoteName) {
  const seenCommits = new Set();
  const seenBlobs = new Set();
  for (const line of stdin.split("\n").filter((entry) => entry.trim().length > 0)) {
    const [localRef, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (!localSha || ZERO.test(localSha)) continue; // ref の削除
    if (git(["cat-file", "-t", localSha]).trim() === "tag") {
      yield { where: `タグ ${localRef}`, text: git(["cat-file", "-p", localSha]) };
    }
    const exclude =
      remoteSha && !ZERO.test(remoteSha) && hasCommit(remoteSha)
        ? [`^${remoteSha}`]
        : isConfiguredRemote(remoteName)
          ? ["--not", `--remotes=${remoteName}`]
          : [];
    const commits = git(["rev-list", localSha, ...exclude]).split("\n").filter(Boolean);
    for (const sha of commits) {
      if (seenCommits.has(sha)) continue;
      seenCommits.add(sha);
      yield* commitTargets(sha, seenBlobs);
    }
  }
}

const targetsFor = (mode, arg) => {
  if (mode === "staged") return stagedTargets();
  if (mode === "message" && arg) return messageTargets(arg);
  if (mode === "push") return pushTargets(readFileSync(0, "utf8"), arg);
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
    process.stderr.write("usage: check-private-terms.mjs staged | message <file> | push <remote>\n");
    return 2;
  }
  const hits = new Set();
  for (const { where, text } of targets) {
    for (const term of findTerms(text, terms)) hits.add(`  ${where}: "${term}"`);
  }
  if (hits.size === 0) return 0;
  process.stderr.write(
    `公開リポジトリに入れない語が含まれています（${file}）:\n${[...hits].join("\n")}\n`,
  );
  return 1;
};

if (import.meta.main) process.exitCode = main();
