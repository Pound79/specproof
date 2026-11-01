import {
  chmodSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { assertNotHardLinked, assertSafeRepositoryWrite } from "./path-security.js";

interface Identity {
  dev: number;
  ino: number;
}

type Entry =
  | { kind: "created"; file: string; written?: Identity }
  | {
      kind: "overwritten";
      file: string;
      content: Buffer;
      mode: number;
      before: Identity;
      written?: Identity;
    };

export interface RollbackResult {
  /** 消した・元に戻したファイルの数。 */
  undone: number;
  /** 戻せなかったパス（別のプロセスが置き換えた、パスが安全でなくなった、操作が失敗した）。 */
  failed: string[];
}

const identityOf = (stat: { dev: number; ino: number }): Identity => ({
  dev: stat.dev,
  ino: stat.ino,
});
const sameIdentity = (stat: { dev: number; ino: number }, id: Identity | undefined): boolean =>
  id !== undefined && stat.dev === id.dev && stat.ino === id.ino;

/**
 * init の書き込みの記録。途中で失敗したら、この実行で作ったファイルを消し、上書きしたファイルを
 * 元の内容と権限に戻し、この実行で作ったディレクトリのうち空になったものを消す。リポジトリを
 * 実行前の状態に揃え、半端な足場を残さない。
 *
 * 取り消しはこの実行が触ったファイルだけに触れる。パスの安全の検査をやり直し（親が symlink に
 * 差し替えられていないか）、上書きしたファイルは書き込みの前か後と同じファイル（dev・inode）の
 * ときだけ戻す。書き込みの途中で失敗した場合（書き込みの記録が無い）も、開いた時点で中身が消えて
 * いるので戻す。合わないものは触らず、戻せなかったものとして返す。
 */
export class ScaffoldJournal {
  private readonly entries: Entry[] = [];
  private readonly createdDirs: string[] = [];

  constructor(private readonly repoRoot: string) {}

  /** 書き込む直前に呼ぶ。既存のファイルなら元の内容・権限・識別子を、無ければ新規として記録する。 */
  recordBefore(file: string): void {
    if (existsSync(file)) {
      const stat = lstatSync(file);
      if (stat.isFile()) {
        this.entries.push({
          kind: "overwritten",
          file,
          content: readFileSync(file),
          mode: stat.mode,
          before: identityOf(stat),
        });
      }
      return;
    }
    this.entries.push({ kind: "created", file });
  }

  /** 書き込んだ直後に呼ぶ。取り消しの時に同じファイルかを確かめるため、識別子を記録する。 */
  recordWritten(file: string): void {
    const entry = [...this.entries].reverse().find((candidate) => candidate.file === file);
    if (entry) entry.written = identityOf(lstatSync(file));
  }

  /** mkdirSync(..., { recursive: true }) の戻り値（最初に作ったディレクトリ）を記録する。 */
  recordCreatedDir(firstCreated: string | undefined): void {
    if (firstCreated !== undefined) this.createdDirs.push(firstCreated);
  }

  /** 書き込みを取り消す。 */
  rollback(): RollbackResult {
    const result: RollbackResult = { undone: 0, failed: [] };
    for (const entry of [...this.entries].reverse()) {
      try {
        this.undo(entry, result);
      } catch {
        result.failed.push(entry.file);
      }
    }
    for (const dir of [...this.createdDirs].reverse()) this.removeEmptyTree(dir, result.failed);
    return result;
  }

  private undo(entry: Entry, result: RollbackResult): void {
    // 無いもの（書き込む前に失敗した新規、別のプロセスが消した）は戻すものが無い。
    if (!existsSync(entry.file)) {
      if (entry.kind === "overwritten") result.failed.push(entry.file);
      return;
    }
    assertSafeRepositoryWrite(this.repoRoot, entry.file);
    const stat = lstatSync(entry.file);
    if (!stat.isFile()) {
      result.failed.push(entry.file);
      return;
    }
    if (entry.kind === "created") {
      // 書き込みの記録があれば同じファイルのときだけ、記録が無ければ（書き込みの途中で失敗した）
      // 残骸として消す。
      if (entry.written !== undefined && !sameIdentity(stat, entry.written)) {
        result.failed.push(entry.file);
        return;
      }
      unlinkSync(entry.file);
      result.undone += 1;
      return;
    }
    if (!sameIdentity(stat, entry.before) && !sameIdentity(stat, entry.written)) {
      result.failed.push(entry.file);
      return;
    }
    // 書き込む前に失敗して、手を付けていなければ戻すものが無い。
    if (
      entry.written === undefined &&
      readFileSync(entry.file).equals(entry.content) &&
      (stat.mode & 0o7777) === (entry.mode & 0o7777)
    ) {
      return;
    }
    assertNotHardLinked(entry.file);
    writeFileSync(entry.file, entry.content);
    // 上書きでテンプレートの権限に変わっていることがあるので、元の権限に戻す。
    chmodSync(entry.file, entry.mode & 0o7777);
    result.undone += 1;
  }

  // dir 以下の空のディレクトリを深い方から消す。ファイルが残るディレクトリと、パスの安全の検査を
  // 通らないもの（symlink を含む）は消さない。
  private removeEmptyTree(dir: string, failed: string[]): void {
    let entries: string[];
    try {
      assertSafeRepositoryWrite(this.repoRoot, dir);
      if (!lstatSync(dir).isDirectory()) return;
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) this.removeEmptyTree(path.join(dir, name), failed);
    try {
      if (readdirSync(dir).length === 0) rmdirSync(dir);
    } catch {
      failed.push(dir);
    }
  }
}
