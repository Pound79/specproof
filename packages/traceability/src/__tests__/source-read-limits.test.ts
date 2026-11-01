import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { computeFileHash, computeHeadingSectionHash, FILE_MISSING } from "../hash.js";

// spec・実装・feature の本体は PR の作者が書ける。大きなファイルや FIFO、計算量の大きい行で
// CI のジョブを止めさせない。
const withDir = async (run: (dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "specproof-read-limits-"));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("8 MiB を超えるファイルは読まずにエラーにする", () =>
  withDir(async (dir) => {
    const file = path.join(dir, "big.md");
    writeFileSync(file, "");
    truncateSync(file, 8 * 1024 * 1024 + 1);
    await assert.rejects(computeFileHash(file), /exceeds 8 MiB/);
  }));

test("8 MiB ちょうどのファイルは読める", () =>
  withDir(async (dir) => {
    const file = path.join(dir, "edge.md");
    writeFileSync(file, "");
    truncateSync(file, 8 * 1024 * 1024);
    assert.match(await computeFileHash(file), /^[0-9a-f]{64}$/);
  }));

test("無いファイルは従来どおり FILE_MISSING", () =>
  withDir(async (dir) => {
    assert.equal(await computeFileHash(path.join(dir, "missing.md")), FILE_MISSING);
  }));

test.skipIf(process.platform === "win32")("FIFO は待たずに通常ファイルでないとして拒否する", () =>
  withDir(async (dir) => {
    const fifo = path.join(dir, "pipe.md");
    execFileSync("mkfifo", [fifo]);
    await assert.rejects(computeFileHash(fifo), /regular file/);
  }),
);

test("見出しの閉じの # を外す処理は、空白の長い並びでも線形の時間で終わる", () =>
  withDir(async (dir) => {
    // 従来の正規表現は空白の数の二乗の時間がかかり、この入力で数十秒かかった。
    const file = path.join(dir, "spec.md");
    writeFileSync(file, `## a${" ".repeat(200_000)}b\n\nbody\n`);
    const started = performance.now();
    await computeHeadingSectionHash(file, "x");
    assert.ok(performance.now() - started < 1_000, "heading parsing must stay linear");
  }));

// 改行の正規化は CRLF だけなので、単独の CR は行の中に残る。CR を含む行で見出しやコードの
// 区切りの正規表現が後戻りし、二乗の時間がかかっていた（見出しでない扱いは従来どおり）。
for (const [label, line] of [
  ["単独の CR を含む見出し", `## ${" ".repeat(200_000)}\rx`],
  ["単独の CR を含むコードの区切り", `${"`".repeat(200_000)}\r`],
  // `.` は CR のほか U+2028・U+2029 にも一致しない。
  ["U+2028 を含む見出し", `## ${" ".repeat(200_000)}\u2028x`],
  ["U+2029 を含むコードの区切り", `${"~".repeat(200_000)}\u2029`],
] as const) {
  test(`${label}の行も線形の時間で終わる`, () =>
    withDir(async (dir) => {
      const file = path.join(dir, "spec.md");
      writeFileSync(file, `## Title\n\n${line}\nbody\n`);
      const started = performance.now();
      await computeHeadingSectionHash(file, "Title");
      assert.ok(performance.now() - started < 1_000, `${label} parsing must stay linear`);
    }));
}

test("CR を含む行は従来どおり見出しとして扱わない", () =>
  withDir(async (dir) => {
    const file = path.join(dir, "spec.md");
    writeFileSync(file, "## Title\n\nbody\n## Other\rx\nmore\n");
    assert.equal(await computeHeadingSectionHash(file, "Other\rx"), "SECTION_MISSING");
    assert.equal(await computeHeadingSectionHash(file, "Other"), "SECTION_MISSING");
  }));

test("閉じの # の扱いは従来どおり", () =>
  withDir(async (dir) => {
    const file = path.join(dir, "spec.md");
    const sections = ["## Title ##", "## Title#", "## #", "## Title \\#", "## A # B #  "];
    writeFileSync(file, sections.map((h) => `${h}\n\nbody\n`).join("\n"));
    // 閉じの # が外れて「Title」になる見出し、外れない見出しを、hash が取れるかで確かめる。
    assert.notEqual(await computeHeadingSectionHash(file, "Title"), "SECTION_MISSING");
    assert.notEqual(await computeHeadingSectionHash(file, "Title#"), "SECTION_MISSING");
    assert.notEqual(await computeHeadingSectionHash(file, "A # B"), "SECTION_MISSING");
    // 閉じの # だけの見出しは空の見出しになり、エスケープした \# は閉じとして外さない。
    assert.notEqual(await computeHeadingSectionHash(file, ""), "SECTION_MISSING");
    assert.notEqual(await computeHeadingSectionHash(file, "Title \\#"), "SECTION_MISSING");
  }));
