import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// このリポジトリは公開 OSS。手元の環境や私的な作業の痕跡を追跡ファイルに入れない。
// 私的なプロジェクト名や本名はここに書くとそれ自体が公開されるため、この試験では扱わず、
// scripts/githooks のフックがリポジトリ外の語彙リストで検査する。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// この試験ファイル自体も走査対象なので、検出対象の形をした文字列は直接書かず部品から組み立てる。
const path = (separator, ...parts) => parts.join(separator);

// 例示や試験で使う架空のユーザー名。実在の環境を示さないので、ホーム配下のパスでも許可する。
const PLACEHOLDER_USERS = new Set(["foo", "bar", "user", "username", "runner", "example", "name", "..."]);

// ホーム（/Users・/home、Windows の \Users）の直後の名前を取り出す。区切りは / と \ の連続を許す。
const HOME_PATH = /[\\/]+(?:Users|home)[\\/]+([^\\/\s"'`)<>\]]+)/;

const RULES = [
  {
    id: "local-path",
    reason: "マシン固有のパス（ホーム・一時ディレクトリ）",
    pattern: new RegExp(
      `${HOME_PATH.source}|[\\\\/]root[\\\\/]|\\/var\\/folders\\/|\\/private\\/(?:tmp|var)\\/|\\/tmp\\/claude[-/]`,
      "g",
    ),
    allow: (match) => {
      const user = HOME_PATH.exec(match)?.[1];
      return user !== undefined && PLACEHOLDER_USERS.has(user.toLowerCase());
    },
  },
  {
    id: "email",
    reason: "許可していないメールアドレス",
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    // 例示用ドメインと GitHub の noreply は、どのファイルでも許可する。
    allow: (match) =>
      /@(?:[A-Za-z0-9-]+\.)*example\.(?:com|org|net)$/i.test(match) ||
      /@(?:users\.)?noreply\.github\.com$/i.test(match) ||
      /^noreply@github\.com$/i.test(match),
  },
];

// 保守者の連絡先。
const CONTACT = ["kma9879", "gmail.com"].join("@");

// ファイルごとに許可する一致: "rule:path" -> { matches, reason }。件数は完全一致で照合する。
const ALLOWED = new Map([
  ["email:SECURITY.md", { matches: [CONTACT], reason: "脆弱性報告の連絡先として公開している" }],
  ["email:CODE_OF_CONDUCT.md", { matches: [CONTACT], reason: "行動規範の報告先として公開している" }],
]);

// 追跡してはいけないパス。
const FORBIDDEN_PATHS = [
  { pattern: /^docs\/evidence\//, reason: "手元の検証記録は公開しない" },
  { pattern: /(^|\/)[^/]*\.local\.md$/, reason: "*.local.md は個人の下書き" },
  { pattern: /(^|\/)\.env(\.(?!example$)[^/]*)?$/, reason: "dotenv は見本以外を追跡しない" },
];

const trackedFiles = () =>
  execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
    .split("\0")
    .filter((file) => file.length > 0);

/** 検査する文字列。symlink はリンク先を読まず、git が記録するリンク先のパスを返す。 */
const readText = (file) => {
  const absolute = join(repoRoot, file);
  try {
    if (lstatSync(absolute).isSymbolicLink()) return readlinkSync(absolute);
    const bytes = readFileSync(absolute);
    return bytes.includes(0) ? null : bytes.toString("utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

const findIn = (text) =>
  RULES.flatMap((rule) =>
    [...text.matchAll(rule.pattern)]
      .map((match) => match[0])
      .filter((match) => !rule.allow?.(match))
      .map((match) => ({ rule: rule.id, match })),
  );

const scan = () => {
  const hits = new Map();
  for (const file of trackedFiles()) {
    const text = readText(file);
    if (text === null) continue;
    for (const { rule, match } of findIn(text)) {
      const key = `${rule}:${file}`;
      hits.set(key, [...(hits.get(key) ?? []), match]);
    }
  }
  return hits;
};

test("追跡ファイルにマシン固有のパスや許可していないメールアドレスを含めない", () => {
  const unexpected = [...scan()]
    .filter(([key]) => !ALLOWED.has(key))
    .map(([key, matches]) => `${key} ${JSON.stringify(matches)}`);
  assert.deepEqual(unexpected, [], `公開してはいけない内容:\n  ${unexpected.join("\n  ")}`);
});

test("許可リストの一致は実際のファイル内容と完全に一致する", () => {
  const hits = scan();
  for (const [key, { matches }] of ALLOWED) {
    assert.deepEqual(hits.get(key) ?? [], matches, key);
  }
});

test("許可リストのすべての項目に理由がある", () => {
  for (const [key, { reason }] of ALLOWED) assert.ok(reason.trim().length > 0, key);
  for (const rule of RULES) assert.ok(rule.reason.trim().length > 0, rule.id);
});

test("手元の記録や個人の下書きを追跡しない", () => {
  const forbidden = trackedFiles().flatMap((file) =>
    FORBIDDEN_PATHS.filter(({ pattern }) => pattern.test(file)).map(
      ({ reason }) => `${file}（${reason}）`,
    ),
  );
  assert.deepEqual(forbidden, []);
});

test("検査規則は代表的な混入を検出し、例示用の表記は通す", () => {
  const leaks = [
    path("/", "", "Users", "alice", "work"),
    `file://${path("/", "", "Users", "alice", "x")}`,
    path("\\", "C:", "Users", "alice", "repo"),
    path("\\\\", "C:", "Users", "alice"),
    path("/", "", "mnt", "c", "Users", "alice"),
    path("/", "", "home", "alice", ".cache"),
    path("/", "", "home", "runner-alice", "work"),
    path("/", "", "root", ".ssh"),
    path("/", "", "var", "folders", "ab", "T", "x"),
    path("/", "", "private", "tmp", "claude-1", "x"),
    path("/", "", "tmp", "claude", "x"),
    ["person", "company.co.jp"].join("@"),
    ["dev", "example.com.evil.io"].join("@"),
  ];
  for (const leak of leaks) assert.equal(findIn(leak).length, 1, leak);

  const allowed = [
    path("/", "", "c", "Users", "foo", "repo"),
    path("/", "C:", "Users", "foo"),
    path("\\", "C:", "Users", "foo"),
    path("/", "", "home", "runner", "work"),
    path("/", "", "home", "user"),
    path("/", "", "c", "Users", "..."),
    ["dev", "example.com"].join("@"),
    ["49699333+bot", "users.noreply.github.com"].join("@"),
  ];
  for (const text of allowed) assert.deepEqual(findIn(text), [], text);

  assert.ok(FORBIDDEN_PATHS[0].pattern.test("docs/evidence/x.json"));
  assert.ok(FORBIDDEN_PATHS[1].pattern.test("notes/release.local.md"));
  assert.ok(FORBIDDEN_PATHS[2].pattern.test("packages/e2e/.env.local"));
  assert.ok(!FORBIDDEN_PATHS[2].pattern.test("packages/e2e/.env.example"));
});
