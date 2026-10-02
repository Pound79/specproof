import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Japanese prose spells "acceptance criteria" as 受け入れ条件, matching the
// spelling used by downstream tools. The short form is assembled from two parts
// so this file does not trip its own check.
const banned = "受入" + "条件";
const needle = Buffer.from(banned, "utf8");

// Files allowed to keep the short form: path -> { count, reason }. The count is
// exact, so both new occurrences and fixed-but-still-listed entries fail.
const allowlist = new Map([]);
// Path prefixes skipped entirely (contents and file names), e.g. tool-managed
// directories: { prefix, reason }. Each must match at least one tracked file.
const excludedPrefixes = [];

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
    .split("\0")
    .filter((f) => f.length > 0);
}

// Bytes, not text: files containing NUL are still scanned. Only a file deleted
// from the working tree (ENOENT) is skipped; any other read error is rethrown.
function readTracked(file) {
  try {
    return readFileSync(join(repoRoot, file));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// 1-based line number of each occurrence.
function hitLines(bytes) {
  const lines = [];
  let line = 1;
  let scanned = 0;
  for (let at = bytes.indexOf(needle); at !== -1; at = bytes.indexOf(needle, at + needle.length)) {
    for (let i = scanned; i < at; i++) if (bytes[i] === 0x0a) line++;
    scanned = at;
    lines.push(line);
  }
  return lines;
}

function scan() {
  const files = trackedFiles();
  const hits = [];
  const allowedActual = new Map();
  const usedPrefixes = new Set();
  for (const file of files) {
    const excluded = excludedPrefixes.find(({ prefix }) => file.startsWith(prefix));
    if (excluded) {
      usedPrefixes.add(excluded.prefix);
      continue;
    }
    if (file.includes(banned)) hits.push(`${file} (ファイル名)`);
    const bytes = readTracked(file);
    const lines = bytes === null ? [] : hitLines(bytes);
    if (allowlist.has(file)) allowedActual.set(file, lines.length);
    else hits.push(...lines.map((line) => `${file}:${line}`));
  }
  return { files, hits, allowedActual, usedPrefixes };
}

test("git-tracked files do not use the short form of 受け入れ条件", () => {
  const { files, hits } = scan();
  assert.ok(files.length > 0, "git ls-files returned no files");
  assert.deepEqual(hits, [], [`Write 受け入れ条件 instead of ${banned}:`, ...hits].join("\n  "));
});

test("allowlist counts and excluded prefixes match the tree", () => {
  const { allowedActual, usedPrefixes } = scan();
  for (const [file, { count }] of allowlist) {
    assert.equal(allowedActual.get(file) ?? 0, count, `${file}: occurrence count differs from allowlist`);
  }
  for (const { prefix } of excludedPrefixes) {
    assert.ok(usedPrefixes.has(prefix), `excluded prefix ${prefix} matches no tracked file`);
  }
});

test("every allowlist entry and excluded prefix has a reason", () => {
  for (const [file, { reason }] of allowlist) assert.ok(reason.trim().length > 0, file);
  for (const { prefix, reason } of excludedPrefixes) assert.ok(reason.trim().length > 0, prefix);
});
