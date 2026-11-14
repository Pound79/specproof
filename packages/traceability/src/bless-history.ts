// drift した参照について、manifest に記録した hash（前に bless した中身）と同じ版を git の履歴から探す。
// manifest には hash しか無いので、「何がどう変わったか」を見るための比較先のコミットを示す。
//
// 参照のパスと hash は manifest 由来（PR が書ける）なので、次を守る。
// - git は execFile で引数の配列として起動し、シェルを通さない。パスは `--` の後ろと `<commit>:./<path>` にだけ渡し、
//   GIT_LITERAL_PATHSPECS でワイルドカードや `:(...)` を文字どおりに扱わせる。
// - 部分 clone で足りない版を取りに行かせない（GIT_NO_LAZY_FETCH）。資格情報を尋ねさせない（GIT_TERMINAL_PROMPT=0）。
// - 探索の総量に上限を置く（git の起動回数と経過時間）。上限に達したら打ち切り、打ち切ったことを返す。
// - 同じパスの参照は、履歴を 1 回だけ辿り、各版を 1 回だけ読む。
import { execFile } from "node:child_process";
import path from "node:path";
import type { DriftEntry } from "./check.js";
import { hashFileContent, hashHeadingSectionContent, normalizeSourceContent } from "./hash.js";
import type { TraceabilityManifest } from "./manifest.js";
import { resolveWithinRoot } from "./resolve.js";

export const MAX_COMMITS = 200;
const MAX_GIT_CALLS = 2_000;
const DEADLINE_MS = 60_000;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const GIT_TIMEOUT_MS = 10_000;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const COMMIT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export interface BlessSearchOptions {
  /** git を起動してよい回数の上限（既定 2,000）。 */
  maxGitCalls?: number;
  /** 探索にかけてよい時間の上限（既定 60 秒）。 */
  deadlineMs?: number;
}

export interface BlessHistory {
  /** git の履歴を辿れたか（git が無い・管理下でない・git がリポジトリを拒んだときは false）。 */
  available: boolean;
  /** 探索の上限に達して打ち切ったか。打ち切った参照の結果は undefined。 */
  incomplete: boolean;
  /** 設定のルートの、git の最上位からの相対パス（末尾に `/`。最上位なら空）。 */
  prefix: string;
  /**
   * entries と同じ順。見つかったコミット（完全な id）、見つからなければ null。
   * 探していない（hash が仮の値・履歴を辿れない・打ち切った）ときは undefined。
   */
  commits: (string | null | undefined)[];
}

type GitResult = { ok: true; stdout: string } | { ok: false };

const GIT_ENV = {
  GIT_LITERAL_PATHSPECS: "1",
  GIT_NO_LAZY_FETCH: "1",
  GIT_TERMINAL_PROMPT: "0",
};

interface GitRunner {
  run(args: string[]): Promise<GitResult>;
  /** 時間の上限を過ぎていれば打ち切りにする。照合のループの中でも見る（git を起動しない間も止まるように）。 */
  overDeadline(): boolean;
  readonly exhausted: boolean;
}

const createGitRunner = (repoRoot: string, options: BlessSearchOptions): GitRunner => {
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
          ["-c", "core.fsmonitor=false", ...args],
          {
            cwd: repoRoot,
            encoding: "utf8",
            env: { ...process.env, ...GIT_ENV },
            maxBuffer: MAX_SOURCE_BYTES,
            timeout: GIT_TIMEOUT_MS,
            windowsHide: true,
          },
          (error, stdout) => resolve(error ? { ok: false } : { ok: true, stdout }),
        );
      });
    },
  };
};

// 参照のパスをルート相対の POSIX 形にする（絶対パスで書かれた参照も、git に渡せる形にそろえる）。
const relativePathOf = (repoRoot: string, refPath: string): string => {
  // resolveWithinRoot は symlink 経由のルートでも root 側の表記に直したパスを返すので、それから相対にする。
  const resolved = resolveWithinRoot(repoRoot, refPath);
  const relative = path.isAbsolute(refPath)
    ? path.relative(path.resolve(repoRoot), resolved)
    : refPath;
  return path.posix.normalize(relative.split(path.sep).join("/"));
};

// 同じリンクに同じパス・見出しの参照が複数の見出しの段で登録されていれば、どの段でも照合する。
const headingLevelsOf = (manifest: TraceabilityManifest, entry: DriftEntry): number[] => {
  const levels = (manifest.links.find((link) => link.id === entry.linkId)?.spec ?? [])
    .filter((ref) => ref.path === entry.path && ref.heading === entry.heading)
    .map((ref) => ref.headingLevel ?? 2);
  return levels.length === 0 ? [2] : [...new Set(levels)];
};

// 1 つの版について、ファイルの hash と見出しの節の hash を、同じ組み合わせでは 1 回だけ計算する。
const versionHasher = (content: string) => {
  let fileHash: string | undefined;
  const sectionHashes = new Map<string, string>();
  return {
    file: (): string => {
      fileHash ??= hashFileContent(content);
      return fileHash;
    },
    section: (heading: string, level: number): string => {
      const key = `${level}\u0000${heading}`;
      const cached = sectionHashes.get(key);
      if (cached !== undefined) return cached;
      const computed = hashHeadingSectionContent(content, heading, level);
      sectionHashes.set(key, computed);
      return computed;
    },
  };
};

const matchesVersion = (
  hasher: ReturnType<typeof versionHasher>,
  entry: DriftEntry,
  levels: number[],
): boolean =>
  entry.side === "spec" && entry.heading !== undefined
    ? levels.some((level) => hasher.section(entry.heading as string, level) === entry.storedHash)
    : hasher.file() === entry.storedHash;

interface PathSearch {
  relPath: string;
  indexes: number[];
}

const searchPath = async (
  git: GitRunner,
  search: PathSearch,
  entries: DriftEntry[],
  manifest: TraceabilityManifest,
  results: (string | null | undefined)[],
): Promise<void> => {
  const target = `./${search.relPath}`;
  const log = await git.run(["log", "--format=%H", `--max-count=${MAX_COMMITS}`, "--", target]);
  if (!log.ok) {
    if (!git.exhausted) for (const index of search.indexes) results[index] = null;
    return;
  }
  const levels = new Map(
    search.indexes.map((index) => [index, headingLevelsOf(manifest, entries[index])]),
  );
  let pending = [...search.indexes];
  for (const commit of log.stdout.split("\n").filter((line) => COMMIT_ID.test(line))) {
    const shown = await git.run(["show", `${commit}:${target}`]);
    if (git.exhausted) return;
    if (!shown.ok) continue;
    const hasher = versionHasher(normalizeSourceContent(shown.stdout));
    const matched: number[] = [];
    for (const index of pending) {
      if (git.overDeadline()) return;
      if (matchesVersion(hasher, entries[index], levels.get(index) ?? [2])) matched.push(index);
    }
    for (const index of matched) results[index] = commit;
    const matchedSet = new Set(matched);
    pending = pending.filter((index) => !matchedSet.has(index));
    if (pending.length === 0) return;
  }
  for (const index of pending) results[index] = null;
};

/** drift した各参照について、bless した中身と同じ版を持つ最も新しいコミットを探す。 */
export const findBlessedCommits = async (
  repoRoot: string,
  entries: DriftEntry[],
  manifest: TraceabilityManifest,
  options: BlessSearchOptions = {},
): Promise<BlessHistory> => {
  const git = createGitRunner(repoRoot, options);
  const results: (string | null | undefined)[] = entries.map(() => undefined);
  const inside = await git.run(["rev-parse", "--is-inside-work-tree", "--show-prefix"]);
  const [isInside, prefix = ""] = inside.ok ? inside.stdout.split("\n") : [];
  if (isInside !== "true") {
    return { available: false, incomplete: false, prefix: "", commits: results };
  }

  const byPath = new Map<string, PathSearch>();
  entries.forEach((entry, index) => {
    if (!SHA256_HEX.test(entry.storedHash)) return;
    const relPath = relativePathOf(repoRoot, entry.path);
    const search = byPath.get(relPath);
    if (search === undefined) byPath.set(relPath, { relPath, indexes: [index] });
    else search.indexes.push(index);
  });
  // パスごとに順に辿る（git の起動を並べて増やさない）。
  for (const search of byPath.values()) {
    await searchPath(git, search, entries, manifest, results);
    if (git.exhausted) break;
  }
  return { available: true, incomplete: git.exhausted, prefix, commits: results };
};
