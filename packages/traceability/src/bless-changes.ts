// --since-bless: drift した参照を、bless した版の後にそれを変えたコミットごとにまとめる。
// コミットは HEAD の first-parent の列で辿る。PR をマージ（または squash）したコミットが 1 件として出るので、
// 「どの PR で変わったか」の単位で見られる。マージに含まれる個々のコミットは出さない。
//
// 候補のコミットごとに、その版と第 1 親の版を参照の単位（spec の見出しは節、ほかはファイル）の hash で比べ、
// 変わったものだけを割り当てる。その版が bless した中身と同じなら、bless した版を持ち込んだだけ（ブランチで
// bless してマージした等）なので割り当てない。版の中身は `git show <commit>:<path>` で読み、作業ツリーを読む
// git（status・diff）は使わない（.gitattributes のフィルタを起動しうる）。コミットしていない変更も、HEAD の版と
// 今の中身の hash を比べて決める。
import type { BlessHistory } from "./bless-history.js";
import { headingLevelsOf, MAX_COMMITS, matchesVersion, versionHasher } from "./bless-history.js";
import type { DriftEntry } from "./check.js";
import type { GitRunner } from "./git-runner.js";
import { FILE_MISSING, normalizeSourceContent } from "./hash.js";
import type { TraceabilityManifest } from "./manifest.js";

const COMMIT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
/** 並べ替えに使う first-parent の列の長さの上限。これより古いコミットは後ろに置く。 */
const RANK_LIMIT = 20_000;

export interface GroupedReference {
  side: DriftEntry["side"];
  path: string;
  linkIds: string[];
}

export interface ChangeCommit {
  commit: string;
  subject: string;
  entries: GroupedReference[];
}

export interface NotGroupedCounts {
  /** bless した版がどのコミットにも見つからなかった。 */
  noBlessedVersion: number;
  /** bless した版を探していない（hash が仮の値・探索の上限で打ち切った・パスがディレクトリ）。 */
  notSearched: number;
  /** 版は見つかったが、変えたコミットも、コミットしていない変更も特定できなかった。 */
  failed: number;
}

export interface ChangesSinceBless {
  /** HEAD に近い順。 */
  commits: ChangeCommit[];
  /** コミットしていない変更がある参照。 */
  uncommitted: GroupedReference[];
  notGrouped: NotGroupedCounts;
  /** git の起動の上限に達した・1 つの範囲が 200 コミットを超えた・読めない版があったなどで、まとめ切れなかったか。 */
  incomplete: boolean;
}

// 参照を (side, path) でまとめ、リンクの id を出てきた順に並べる。順は report.entries に従う。
const groupReferences = (entries: DriftEntry[], indexes: Set<number>): GroupedReference[] => {
  const groups = new Map<string, GroupedReference>();
  entries.forEach((entry, index) => {
    if (!indexes.has(index)) return;
    const key = `${entry.side}\u0000${entry.path}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { side: entry.side, path: entry.path, linkIds: [entry.linkId] });
    } else if (!group.linkIds.includes(entry.linkId)) {
      groups.set(key, { ...group, linkIds: [...group.linkIds, entry.linkId] });
    }
  });
  return [...groups.values()];
};

type Hasher = ReturnType<typeof versionHasher>;

const FAILED = "failed" as const;
type Version = Hasher | null | typeof FAILED;

// `git show` が失敗したとき、その版にパスが無い（null）のか、読めなかった（FAILED）のかを分ける。
// 第 1 親が無い（最初のコミット）なら null。パスが木に無ければ null。それ以外は FAILED。
const classifyMissing = async (
  git: GitRunner,
  rev: string,
  searchPath: string,
): Promise<Version> => {
  if (rev.endsWith("^1")) {
    const parent = await git.run(["rev-parse", "--verify", "--quiet", "--end-of-options", rev]);
    if (!parent.ok) return parent.code === 1 ? null : FAILED;
  }
  // `git show <rev>:./<path>` と同じく、作業ディレクトリ（設定のルート）からのパスで調べる（--full-tree にすると
  // 設定のルートが git のサブディレクトリのとき、最上位の同じ名前のファイルを見てしまう）。
  const listed = await git.run(["ls-tree", "-z", rev, "--", searchPath]);
  if (!listed.ok) return FAILED;
  return listed.stdout.split("\u0000").some((record) => record.endsWith(`\t${searchPath}`))
    ? FAILED
    : null;
};

// 版の中身を 1 回だけ読む。無い（消えた・まだ無い）版は null、読めなかった版は FAILED。
const versionReader = (git: GitRunner) => {
  const cache = new Map<string, Version>();
  return async (rev: string, searchPath: string): Promise<Version> => {
    const key = `${rev}\u0000${searchPath}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const shown = await git.run(["show", `${rev}:./${searchPath}`]);
    const version = shown.ok
      ? versionHasher(normalizeSourceContent(shown.stdout))
      : await classifyMissing(git, rev, searchPath);
    if (!git.exhausted) cache.set(key, version);
    return version;
  };
};

// 参照の単位の中身を表す値（比べるためだけに使う）。spec の見出しは、登録された段の節の hash を並べる。
const versionKey = (hasher: Hasher | null, entry: DriftEntry, levels: number[]): string => {
  if (hasher === null) return "missing";
  return entry.side === "spec" && entry.heading !== undefined
    ? levels.map((level) => hasher.section(entry.heading as string, level)).join(",")
    : hasher.file();
};

// 範囲の中で、そのパスに触れた first-parent のコミット（新しい順）。
const logRange = async (
  git: GitRunner,
  revisions: string[],
  searchPath: string,
): Promise<{ commit: string; subject: string }[] | undefined> => {
  const log = await git.run([
    "log",
    "--first-parent",
    "--no-show-signature",
    "--format=%H%x1f%s",
    `--max-count=${MAX_COMMITS}`,
    ...revisions,
    "--",
    `./${searchPath}`,
  ]);
  if (!log.ok) return undefined;
  return log.stdout
    .split("\n")
    .map((line) => {
      const at = line.indexOf("\u001f");
      return { commit: line.slice(0, at), subject: line.slice(at + 1) };
    })
    .filter((line) => COMMIT_ID.test(line.commit));
};

// HEAD の first-parent の列（HEAD から古い方へ）。並べ替えと範囲の決定に使う。git を 1 回だけ起動する。
const firstParentChain = async (git: GitRunner): Promise<string[]> => {
  const listed = await git.run(["rev-list", "--first-parent", `--max-count=${RANK_LIMIT}`, "HEAD"]);
  return listed.ok ? listed.stdout.split("\n").filter((line) => COMMIT_ID.test(line)) : [];
};

// 候補を取る範囲。bless した版を含む、first-parent の列で最も古いコミット E から HEAD まで（E を含む）。
// `<blessed>..HEAD` では、main が進まないままブランチをマージしたとき、マージの第 1 親が bless した版の祖先に
// なって、bless の後にブランチで変えた中身を持ち込んだマージが範囲から外れる。bless した版の子孫を
// `rev-list --ancestry-path <blessed>..HEAD` で 1 回だけ取り、その中で first-parent の列の最も古いものを E にする
// （`--first-parent` と一緒に使うと、bless した版がブランチの側にあるとき何も返らない）。HEAD が bless した版
// そのもの（子孫が無い）なら範囲は空。決められない（git の失敗・列が上限で切れて E が無い）なら undefined。
const rangeRevisions = async (
  git: GitRunner,
  chain: string[],
  blessed: string,
): Promise<string[] | undefined> => {
  const listed = await git.run(["rev-list", "--ancestry-path", `${blessed}..HEAD`]);
  if (!listed.ok) return undefined;
  const descendants = new Set(listed.stdout.split("\n").filter((line) => COMMIT_ID.test(line)));
  if (descendants.size === 0) return [];
  const oldest = [...chain].reverse().find((commit) => descendants.has(commit));
  // 列が上限で切れていて、その末尾まで子孫なら、本当の境界は列の外にあるかもしれない（確かめられない）。
  const truncatedAtOldest = chain.length >= RANK_LIMIT && oldest === chain.at(-1);
  return oldest === undefined || truncatedAtOldest ? undefined : ["HEAD", "--not", `${oldest}^1`];
};

interface Range {
  blessed: string;
  searchPath: string;
  indexes: number[];
}

const rangesOf = (history: BlessHistory): Range[] => {
  const ranges = new Map<string, Range>();
  history.commits.forEach((blessed, index) => {
    const searchPath = history.paths[index];
    if (typeof blessed !== "string" || searchPath === undefined || searchPath === ".") return;
    const key = `${blessed}\u0000${searchPath}`;
    const range = ranges.get(key);
    ranges.set(key, {
      blessed,
      searchPath,
      indexes: [...(range?.indexes ?? []), index],
    });
  });
  return [...ranges.values()];
};

/** drift した参照を、bless の後にそれを変えたコミットごとにまとめる。history は findBlessedCommits の結果。 */
export const groupChangesSinceBless = async (
  git: GitRunner,
  entries: DriftEntry[],
  history: BlessHistory,
  manifest: TraceabilityManifest,
): Promise<ChangesSinceBless> => {
  const read = versionReader(git);
  const levelsOf = (index: number): number[] => headingLevelsOf(manifest, entries[index]);
  const subjects = new Map<string, string>();
  const byCommit = new Map<string, Set<number>>();
  const uncommitted = new Set<number>();
  const traced = new Set<number>();
  const finished = new Set<number>();
  const failed = new Set<number>();
  const chain = await firstParentChain(git);
  const revisionsOf = new Map<string, string[] | undefined>();
  let truncated = false;

  for (const range of rangesOf(history)) {
    const revisions = revisionsOf.has(range.blessed)
      ? revisionsOf.get(range.blessed)
      : await rangeRevisions(git, chain, range.blessed);
    revisionsOf.set(range.blessed, revisions);
    if (git.exhausted) break;
    // 範囲を決められない・辿れないときは、変えたコミットは割り当てずに「辿れなかった」とし、
    // コミットしていない変更の確認は続ける。
    const candidates =
      revisions === undefined
        ? undefined
        : revisions.length === 0
          ? []
          : await logRange(git, revisions, range.searchPath);
    if (git.exhausted) break;
    if (candidates === undefined) {
      truncated = true;
      for (const index of range.indexes) failed.add(index);
    }
    if ((candidates ?? []).length >= MAX_COMMITS) truncated = true;
    for (const { commit, subject } of candidates ?? []) {
      const current = await read(commit, range.searchPath);
      const parent = await read(`${commit}^1`, range.searchPath);
      if (git.exhausted) break;
      if (current === FAILED || parent === FAILED) {
        for (const index of range.indexes) failed.add(index);
        continue;
      }
      for (const index of range.indexes) {
        const entry = entries[index];
        const levels = levelsOf(index);
        const changed = versionKey(current, entry, levels) !== versionKey(parent, entry, levels);
        const bringsBlessed = current !== null && matchesVersion(current, entry, levels);
        if (!changed || bringsBlessed) continue;
        subjects.set(commit, subject);
        byCommit.set(commit, new Set([...(byCommit.get(commit) ?? []), index]));
        traced.add(index);
      }
    }
    const head = await read("HEAD", range.searchPath);
    if (git.exhausted) break;
    for (const index of range.indexes) {
      const entry = entries[index];
      if (head === FAILED) {
        failed.add(index);
        finished.add(index);
        continue;
      }
      // HEAD の版と今の中身を同じ単位の hash で比べる（節が無ければ SECTION_MISSING、ファイルが無ければ FILE_MISSING）。
      const isUncommitted =
        head === null
          ? entry.currentHash !== FILE_MISSING
          : !matchesVersion(head, { ...entry, storedHash: entry.currentHash }, levelsOf(index));
      if (isUncommitted) {
        uncommitted.add(index);
        traced.add(index);
      }
      finished.add(index);
    }
  }

  const rank = new Map(chain.map((commit, index) => [commit, index]));
  const order = [...byCommit.keys()].sort(
    (a, b) =>
      (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER) ||
      a.localeCompare(b),
  );
  const notGrouped = history.commits.reduce<NotGroupedCounts>(
    (counts, blessed, index) => {
      if (traced.has(index)) return counts;
      if (blessed === null) return { ...counts, noBlessedVersion: counts.noBlessedVersion + 1 };
      // 上限で打ち切って手を付けなかった参照も「探していない」に数える。
      if (blessed === undefined || history.paths[index] === "." || !finished.has(index)) {
        return { ...counts, notSearched: counts.notSearched + 1 };
      }
      return { ...counts, failed: counts.failed + 1 };
    },
    { noBlessedVersion: 0, notSearched: 0, failed: 0 },
  );
  return {
    commits: order.map((commit) => ({
      commit,
      subject: subjects.get(commit) ?? "",
      entries: groupReferences(entries, byCommit.get(commit) ?? new Set()),
    })),
    uncommitted: groupReferences(entries, uncommitted),
    notGrouped,
    incomplete: git.exhausted || truncated || failed.size > 0,
  };
};
