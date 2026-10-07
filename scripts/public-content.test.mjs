import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// このリポジトリは公開 OSS。手元の環境や私的な作業の痕跡を追跡ファイルに入れない。
// 私的なプロジェクト名や本名はここに書くとそれ自体が公開されるため、この試験では扱わず、
// scripts/githooks の pre-commit がリポジトリ外の語彙リストで検査する。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const RULES = [
  {
    id: "local-path",
    reason: "マシン固有のパス（ホーム・一時ディレクトリ）",
    pattern:
      /(?<![A-Za-z0-9:/])\/(?:Users|home)\/(?!runner\b)[A-Za-z0-9._-]+|\/var\/folders\/|\/private\/(?:tmp|var)\/|\/tmp\/claude-/g,
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

// 保守者の連絡先。ここに直接書くと自分自身に一致するため、部品から組み立てる。
const CONTACT = ["kma9879", "gmail.com"].join("@");

// ファイルごとに許可する一致: "rule:path" -> { matches, reason }。件数は完全一致で照合する。
const ALLOWED = new Map([
  [
    "email:SECURITY.md",
    { matches: [CONTACT], reason: "脆弱性報告の連絡先として公開している" },
  ],
  [
    "email:CODE_OF_CONDUCT.md",
    { matches: [CONTACT], reason: "行動規範の報告先として公開している" },
  ],
  [
    "local-path:packages/traceability/src/__tests__/paths.test.ts",
    {
      matches: ["/home/user", "/home/user"],
      reason: "MSYS パス変換の試験用の架空パス",
    },
  ],
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

const readText = (file) => {
  try {
    const bytes = readFileSync(join(repoRoot, file));
    return bytes.includes(0) ? null : bytes.toString("utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

const scan = () => {
  const hits = new Map();
  for (const file of trackedFiles()) {
    const text = readText(file);
    if (text === null) continue;
    for (const rule of RULES) {
      const matches = [...text.matchAll(rule.pattern)]
        .map((match) => match[0])
        .filter((match) => !rule.allow?.(match));
      if (matches.length > 0) hits.set(`${rule.id}:${file}`, matches);
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

test("検査規則は代表的な混入を実際に検出する", () => {
  const sample = [
    "/Users/someone/work/repo",
    "/home/someone/.cache",
    "/var/folders/ab/cd/T/x",
    "/private/tmp/claude-1/x",
    "person@company.co.jp",
  ].join("\n");
  const found = RULES.flatMap((rule) =>
    [...sample.matchAll(rule.pattern)].map((m) => m[0]).filter((m) => !rule.allow?.(m)),
  );
  assert.equal(found.length, 5, JSON.stringify(found));
  const allowed = ["/c/Users/foo", "C:/Users/foo", "/home/runner/work", "dev@example.com"].join(
    "\n",
  );
  const allowedHits = RULES.flatMap((rule) =>
    [...allowed.matchAll(rule.pattern)].map((m) => m[0]).filter((m) => !rule.allow?.(m)),
  );
  assert.deepEqual(allowedHits, []);
  assert.ok(FORBIDDEN_PATHS[0].pattern.test("docs/evidence/x.json"));
  assert.ok(FORBIDDEN_PATHS[2].pattern.test("packages/e2e/.env.local"));
  assert.ok(!FORBIDDEN_PATHS[2].pattern.test("packages/e2e/.env.example"));
});
