import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScaffoldJournal } from "../scaffold-journal.js";

// 取り消しは、この実行が書いたファイルだけに触れる。書き込みの後に別のプロセスが置き換えた
// ファイルや、親が symlink に差し替えられたパスは触らず、戻せなかったものとして返す。
describe("ScaffoldJournal.rollback", () => {
  let base: string;
  let repo: string;
  beforeEach(() => {
    base = mkdtempSync(path.join(os.tmpdir(), "specproof-journal-"));
    repo = path.join(base, "repo");
    mkdirSync(repo);
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("does not delete a file another process put in place of the one it created", () => {
    const journal = new ScaffoldJournal(repo);
    const file = path.join(repo, "a.txt");
    journal.recordBefore(file);
    writeFileSync(file, "ours");
    journal.recordWritten(file);
    // 元のファイルを残したまま置き換える（消すと inode 番号が再利用されうるので、識別子では
    // 見分けられない。それは dev・inode による確認の限界）。
    renameSync(file, `${file}.moved`);
    writeFileSync(file, "theirs");
    expect(journal.rollback().failed).toEqual([file]);
    expect(existsSync(file)).toBe(true);
  });

  it("does not follow a parent directory replaced by a symlink to outside the repository", () => {
    const journal = new ScaffoldJournal(repo);
    const dir = path.join(repo, "sub");
    mkdirSync(dir);
    const file = path.join(dir, "a.txt");
    journal.recordBefore(file);
    writeFileSync(file, "ours");
    journal.recordWritten(file);
    const outside = path.join(base, "outside");
    mkdirSync(outside);
    writeFileSync(path.join(outside, "a.txt"), "keep");
    rmSync(dir, { recursive: true });
    symlinkSync(outside, dir);
    expect(journal.rollback().failed).toEqual([file]);
    expect(existsSync(path.join(outside, "a.txt"))).toBe(true);
  });

  it("deletes the file it created when nothing changed", () => {
    const journal = new ScaffoldJournal(repo);
    const file = path.join(repo, "a.txt");
    journal.recordBefore(file);
    writeFileSync(file, "ours");
    journal.recordWritten(file);
    expect(journal.rollback().failed).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  // 書き込みの途中で失敗すると recordWritten は呼ばれない。上書きのファイルは開いた時点で中身が
  // 消えているので、書き込む前と同じファイルなら元に戻す。
  it("restores a file whose overwrite failed part-way", () => {
    const journal = new ScaffoldJournal(repo);
    const file = path.join(repo, "a.txt");
    writeFileSync(file, "original");
    journal.recordBefore(file);
    writeFileSync(file, "par"); // 途中まで書いて失敗した
    expect(journal.rollback().failed).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe("original");
  });

  it("removes a new file whose write failed part-way", () => {
    const journal = new ScaffoldJournal(repo);
    const file = path.join(repo, "a.txt");
    journal.recordBefore(file);
    writeFileSync(file, "par");
    expect(journal.rollback().failed).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it("leaves an existing file alone when it failed before writing it", () => {
    const journal = new ScaffoldJournal(repo);
    const file = path.join(repo, "a.txt");
    writeFileSync(file, "original");
    journal.recordBefore(file);
    expect(journal.rollback().failed).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe("original");
  });

  // copyFileSync はコピーの途中で失敗すると宛先を消す（Node の仕様）。上書きしていたファイルが
  // 無くなっていても、記録した内容と権限で作り直す。
  it("recreates a file it was overwriting when the failed copy deleted it", () => {
    const journal = new ScaffoldJournal(repo);
    const file = path.join(repo, "a.txt");
    writeFileSync(file, "original", { mode: 0o600 });
    journal.recordBefore(file);
    rmSync(file); // コピーの失敗で宛先が消えた
    expect(journal.rollback()).toEqual({ undone: 1, failed: [] });
    expect(readFileSync(file, "utf8")).toBe("original");
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
