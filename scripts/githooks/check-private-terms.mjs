#!/usr/bin/env node
// 公開 OSS に私的な名前（下流の個人プロジェクト名・本名・勤務先など）を入れないための検査。
// 語彙はリポジトリの外に置く（ここに書くとそれ自体が公開されるため）:
//   $SPECPROOF_PRIVATE_TERMS、未設定なら ${XDG_CONFIG_HOME:-~/.config}/git/private-terms.txt
// 1 行 1 語。空行と `#` で始まる行は無視し、大文字小文字を区別せず固定文字列で照合する。
//
// scripts/githooks の各フックから呼ぶ:
//   staged                pre-commit: ステージした各ファイルの内容・パスと作者/committer の名義
//   message <file>        commit-msg: コミットメッセージ（cleanup 前の全文）
//   push <remote name>    pre-push:   送る全コミットの名義・本文・変更ファイルの内容とパス、
//                         送り先の ref 名とタグの参照先。amend / rebase で引き継いだ名義や
//                         verbatim のメッセージ、フックを迂回したコミットもここで止める最終関門。
//
// 内容は diff の追加行ではなく、変更された blob 全体を読む。git が binary とみなす
// テキスト（属性や NUL を含む UTF-16）、種別の変更、merge で持ち込んだ内容も漏らさない。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

/** cleanup の実効値は CLI 引数でも上書きされるため、設定から捨てる行を推測しない。 */
const messageTargets = (file) => [
  { where: "コミットメッセージ", text: readFileSync(file, "utf8") },
];

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

/**
 * 送り先の SHA が手元にあるか。履歴を書き換えた後の force push では無いのが正常なので、
 * 存在確認の失敗を git のエラーとして表示しない（その場合は全体を検査する）。
 */
const hasCommit = (sha) => {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const isConfiguredRemote = (name) =>
  name !== undefined && git(["remote"]).split("\n").includes(name);

/** 注釈付きタグを最後まで辿り、内側の名義・本文・タグ名も検査する。 */
function* peelTags(sha, label, seenTags) {
  let object = sha;
  let type = git(["cat-file", "-t", object]).trim();
  while (type === "tag") {
    const text = git(["cat-file", "-p", object]);
    if (!seenTags.has(object)) {
      seenTags.add(object);
      yield { where: `${label} タグ ${object.slice(0, 12)}`, text };
    }
    const target = /^object ([0-9a-f]+)\n/.exec(text)?.[1];
    if (!target) throw new Error("private-terms: invalid tag object");
    object = target;
    type = git(["cat-file", "-t", object]).trim();
  }
  return { object, type };
}

/** commit を指さないタグも、送られる tree のパスと blob 全体を検査する。 */
function* nonCommitTargets(object, type, label, seenBlobs) {
  if (type === "blob") {
    yield* fileTargets([{ path: object, blob: object, gitlink: false }], label, seenBlobs);
    return;
  }
  if (type !== "tree") throw new Error("private-terms: unsupported object type");
  // -t は空ディレクトリの名前も含める。TAB/NUL で区切り、引用された表示名は使わない。
  const entries = git(["ls-tree", "-r", "-t", "-z", "--full-tree", object])
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf("\t");
      const [, entryType, blob] = entry.slice(0, tab).split(" ");
      return { path: entry.slice(tab + 1), blob, gitlink: entryType !== "blob" };
    });
  yield* fileTargets(entries, label, seenBlobs);
}

/**
 * pre-push の標準入力（ref ごとに "<local ref> <local sha> <remote ref> <remote sha>"）。
 * 送り先が既に持つコミットだけを除く。別のリモートにあるコミットは送り先には新しいので検査する。
 */
function* pushTargets(stdin, remoteName) {
  const seenCommits = new Set();
  const seenBlobs = new Set();
  const seenTags = new Set();
  for (const line of stdin.split("\n").filter((entry) => entry.trim().length > 0)) {
    const [, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
    if (!localSha || ZERO.test(localSha)) continue; // ref の削除
    // refspec で名前を変えて送る場合、公開されるのは local ref でなく remote ref。
    yield { where: "送り先の ref 名", text: remoteRef };
    const { object, type } = yield* peelTags(localSha, remoteRef, seenTags);
    if (type !== "commit") {
      yield* nonCommitTargets(object, type, `${remoteRef} `, seenBlobs);
      continue;
    }
    const exclude =
      remoteSha && !ZERO.test(remoteSha) && hasCommit(remoteSha)
        ? [`^${remoteSha}`]
        : isConfiguredRemote(remoteName)
          ? ["--not", `--remotes=${remoteName}`]
          : [];
    const commits = git(["rev-list", object, ...exclude]).split("\n").filter(Boolean);
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

// import.meta.main の無い Node.js 24.0 / 24.1 でも、フックを黙って省略しない。
const isMain =
  import.meta.main ??
  (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href);
if (isMain) process.exitCode = main();
