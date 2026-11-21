// --since-bless が git を起動する役。起動の総量に上限（回数と経過時間）を置き、上限に達したら打ち切る。
//
// 引数のパスやコミットは manifest 由来（PR が書ける）なので、次を守る。
// - git は execFile で引数の配列として起動し、シェルを通さない。
// - GIT_LITERAL_PATHSPECS でワイルドカードや `:(...)` を文字どおりに扱わせる。
// - 部分 clone で足りない版を取りに行かせない（GIT_NO_LAZY_FETCH）。資格情報を尋ねさせない（GIT_TERMINAL_PROMPT=0）。
// - リポジトリの設定で外部のプログラムを動かさない（下の SAFE_CONFIG）。作業ツリーを読む呼び出し（status・diff）は
//   .gitattributes のフィルタを起動しうるので使わず、版の中身は `git show <commit>:<path>` で読む。
import { execFile } from "node:child_process";

const MAX_GIT_CALLS = 2_000;
const DEADLINE_MS = 60_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const GIT_TIMEOUT_MS = 10_000;

export type GitResult = { ok: true; stdout: string } | { ok: false };

export interface GitRunnerOptions {
  /** git を起動してよい回数の上限（既定 2,000）。 */
  maxGitCalls?: number;
  /** 探索にかけてよい時間の上限（既定 60 秒）。 */
  deadlineMs?: number;
}

export interface GitRunner {
  run(args: string[]): Promise<GitResult>;
  /** 時間の上限を過ぎていれば打ち切りにする。照合のループの中でも見る（git を起動しない間も止まるように）。 */
  overDeadline(): boolean;
  readonly exhausted: boolean;
}

// リポジトリや利用者の設定で、外部のプログラム（fsmonitor・署名の検証の gpg）を起動させない。
// log.follow で辿る履歴を変えさせない。作業ツリーの中の bare リポジトリを暗黙に見つけさせない。
const SAFE_CONFIG = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "log.showSignature=false",
  "-c",
  "log.follow=false",
  "-c",
  "safe.bareRepository=explicit",
];

const GIT_ENV = {
  GIT_LITERAL_PATHSPECS: "1",
  GIT_NO_LAZY_FETCH: "1",
  GIT_TERMINAL_PROMPT: "0",
};

export const createGitRunner = (repoRoot: string, options: GitRunnerOptions = {}): GitRunner => {
  const maxCalls = options.maxGitCalls ?? MAX_GIT_CALLS;
  const deadline = Date.now() + (options.deadlineMs ?? DEADLINE_MS);
  let calls = 0;
  let exhausted = false;
  return {
    get exhausted() {
      return exhausted;
    },
    overDeadline: () => {
      if (Date.now() >= deadline) exhausted = true;
      return exhausted;
    },
    run: (args) => {
      if (exhausted || calls >= maxCalls || Date.now() >= deadline) {
        exhausted = true;
        return Promise.resolve({ ok: false });
      }
      calls += 1;
      return new Promise((resolve) => {
        execFile(
          "git",
          [...SAFE_CONFIG, ...args],
          {
            cwd: repoRoot,
            encoding: "utf8",
            env: { ...process.env, ...GIT_ENV },
            maxBuffer: MAX_OUTPUT_BYTES,
            timeout: GIT_TIMEOUT_MS,
            windowsHide: true,
          },
          (error, stdout) => resolve(error ? { ok: false } : { ok: true, stdout }),
        );
      });
    },
  };
};
