// 写した仕様の取り込み元（specproof.config.yaml の specSources）。取り込んだコミットは manifest の
// specSources に記録し（specproof-update --record-spec-source）、`specproof-check --spec-sources` は
// 取り込み元の ref が記録したコミットから paths の中で進んでいれば知らせる。
//
// 設定は PR が書けるので、次を守る。
// - check は、フラグで明示したときだけ取り込み元を読む（既定の CI の実行では、PR が指すディレクトリで git を
//   起動しない）。取り込みのコマンド（importCommand）は CLI では実行しない。
// - 取り込み元は、そのディレクトリの直下に実体の `.git` ディレクトリ（シンボリックリンク・ファイルでない）が
//   あるときだけ読み、`--git-dir` で明示する（親のリポジトリや bare リポジトリを探させない）。git は git-runner
//   （transport を禁じ、外部のプログラムを起動しない設定、受け継いだ GIT_DIR などを消した環境）で起動し、
//   コミットと中身の id を読むだけにする。fetch しない。作業ツリーは読まない。
// - ref は名前の形だけを受け、`--end-of-options` の後ろにだけ置く。
import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { createGitRunner, type GitRunner } from "./git-runner.js";

export interface SpecSource {
  name: string;
  /** 取り込み元のチェックアウトのルート（ルート相対か絶対）。 */
  repo: string;
  /** 比べる ref（例: origin/develop）。 */
  ref: string;
  /** 取り込み元のルートから見た、比べるパス。省略時はリポジトリ全体。 */
  paths: string[];
  /** 写した先（ルート相対）。skill が読む。 */
  specDir?: string;
  /** 取り込みのコマンド。skill だけが読み、人の承認を得てから実行する。CLI は実行しない。 */
  importCommand?: string;
}

/**
 * unavailable の理由。source-missing（`repo` のパスが無い）だけは警告を出さずに飛ばす。
 * - source-unreadable: パスはあるが取り込み元として読まない（実体の `.git` が無い・持ち主が違う・worktree・部分 clone）
 * - ref-unresolved: `ref` を解決できない
 * - recorded-missing: 記録したコミットが取り込み元に無い（fetch していない・浅い clone・履歴の書き換え）
 * - read-failed: git が途中で失敗した（object を読めない・呼び出しの上限や期限）
 */
export type SpecSourceUnavailableReason =
  | "source-missing"
  | "source-unreadable"
  | "ref-unresolved"
  | "recorded-missing"
  | "read-failed";

export type SpecSourceStatus =
  | "current"
  | "outdated"
  | "path-missing"
  | "unrecorded"
  | "unavailable";

export interface SpecSourceResult {
  name: string;
  status: SpecSourceStatus;
  /** manifest に記録したコミット。 */
  recorded?: string;
  /** 取り込み元の ref が今指すコミット。 */
  current?: string;
  /** path-missing のとき、今の ref に無いパス。 */
  missingPaths?: string[];
  /** unavailable のとき、その理由。 */
  reason?: SpecSourceUnavailableReason;
}

export const SPEC_SOURCE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const COMMIT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
// ブランチ・タグ・リモートのブランチの名前だけを受ける（`@{...}`・`^`・`~`・`:` などの式は受けない）。
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;
const MAX_SOURCES = 32;
const MAX_PATHS = 64;
const MAX_TEXT_LENGTH = 4096;
const OBJECT_ID = COMMIT_ID;
const ENTRY_MODE = /^[0-7]{6}$/;
const ENTRY_TYPE = /^(?:blob|tree|commit)$/;

const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_TEXT_LENGTH &&
  !/[\u0000-\u001f\u007f]/.test(value);

// 末尾の `/` を落とし、`.` はリポジトリ全体（undefined）にする。
const normalizeSourcePath = (entry: string): string | undefined => {
  const normalized = path.posix.normalize(entry).replace(/\/+$/, "");
  return normalized === "" || normalized === "." ? undefined : normalized;
};

const isInsidePath = (entry: unknown): entry is string =>
  isNonEmptyString(entry) &&
  !path.posix.isAbsolute(entry) &&
  path.posix.normalize(entry) !== ".." &&
  !path.posix.normalize(entry).startsWith("../");

const readSource = (item: unknown, at: string, names: Set<string>): SpecSource => {
  if (!isMapping(item)) throw new Error(`${at} must be a mapping`);
  const { name, repo, ref, paths, specDir, importCommand } = item;
  if (typeof name !== "string" || !SPEC_SOURCE_NAME.test(name)) {
    throw new Error(`${at}.name must be letters, digits, ".", "_" or "-" (at most 128)`);
  }
  if (names.has(name)) throw new Error(`${at}.name is duplicated`);
  names.add(name);
  if (!isNonEmptyString(repo)) throw new Error(`${at}.repo must be a non-empty path`);
  if (typeof ref !== "string" || !REF.test(ref) || ref.includes("..") || ref.endsWith(".lock")) {
    throw new Error(
      `${at}.ref must be a remote-tracking or local branch name (e.g. origin/develop), a full ref name (e.g. refs/tags/v1) or a full commit id`,
    );
  }
  if (
    paths !== undefined &&
    paths !== null &&
    (!Array.isArray(paths) || paths.length > MAX_PATHS || !paths.every(isInsidePath))
  ) {
    throw new Error(
      `${at}.paths must be an array of at most ${MAX_PATHS} relative paths inside the source repository`,
    );
  }
  for (const [key, field] of [
    ["specDir", specDir],
    ["importCommand", importCommand],
  ] as const) {
    if (field !== undefined && field !== null && !isNonEmptyString(field)) {
      throw new Error(`${at}.${key} must be a non-empty string`);
    }
  }
  return {
    name,
    repo,
    ref,
    // `.` を含めばリポジトリ全体（空）として比べる。
    paths:
      Array.isArray(paths) && paths.every((entry) => normalizeSourcePath(entry) !== undefined)
        ? paths.map((entry) => normalizeSourcePath(entry) as string)
        : [],
    ...(typeof specDir === "string" ? { specDir } : {}),
    ...(typeof importCommand === "string" ? { importCommand } : {}),
  };
};

/** 設定の specSources を確かめて読む。省略なら空。誤りは設定のキーを示して止める（値は写さない）。 */
export const readSpecSources = (value: unknown, sourceName: string): SpecSource[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_SOURCES) {
    throw new Error(
      `${sourceName}: specSources must be an array of at most ${MAX_SOURCES} entries`,
    );
  }
  const names = new Set<string>();
  return value.map((item, index) =>
    readSource(item, `${sourceName}: specSources[${index}]`, names),
  );
};

type Unavailable = { reason: SpecSourceUnavailableReason };

const isMissingPathError = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
};

/**
 * 取り込み元の git ディレクトリ。`<repo>/.git` が実体のディレクトリで、自分が持ち主で、別の git ディレクトリへ
 * 読み先を移す `commondir` が無いときだけ。`repo` のパスが無ければ source-missing、あっても読まないものは
 * source-unreadable。パスがあるかどうかは出力から分かる（docs/security-model.md）が、読まない理由（持ち主・
 * worktree・部分 clone など）は分けず、PR で変えられる `repo` から分かることを増やさない。
 */
const sourceGitDir = (repoRoot: string, source: SpecSource): { gitDir: string } | Unavailable => {
  let repoPath: string;
  try {
    repoPath = realpathSync(path.resolve(repoRoot, source.repo));
  } catch (error) {
    return { reason: isMissingPathError(error) ? "source-missing" : "source-unreadable" };
  }
  try {
    const gitDir = path.join(repoPath, ".git");
    const stat = lstatSync(gitDir);
    if (!stat.isDirectory()) return { reason: "source-unreadable" };
    // --git-dir を明示すると git は持ち主を確かめない（safe.directory）。ほかの利用者のリポジトリの設定は読まない。
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      return { reason: "source-unreadable" };
    }
    if (existsSync(path.join(gitDir, "commondir"))) return { reason: "source-unreadable" };
    return { gitDir };
  } catch {
    return { reason: "source-unreadable" };
  }
};

// 部分 clone は、足りないオブジェクトを取りに行く設定を持つので読まない（取得させない防御を重ねる）。
const isPartialClone = async (git: GitRunner): Promise<boolean | undefined> => {
  const listed = await git.run(["config", "--null", "--list"]);
  if (!listed.ok) return undefined;
  return listed.stdout.split("\u0000").some((record) => {
    const [key, value = ""] = record.split("\n");
    const lower = key.toLowerCase();
    return (
      lower === "extensions.partialclone" ||
      (lower.startsWith("remote.") &&
        lower.endsWith(".promisor") &&
        value.toLowerCase() !== "false")
    );
  });
};

const sourceGit = async (
  repoRoot: string,
  source: SpecSource,
): Promise<{ git: GitRunner; repoPath: string } | Unavailable> => {
  const found = sourceGitDir(repoRoot, source);
  if (!("gitDir" in found)) return found;
  const { gitDir } = found;
  const repoPath = path.dirname(gitDir);
  const git = createGitRunner(repoPath, {
    gitDir,
    maxGitCalls: 2 * MAX_PATHS + 8,
    deadlineMs: 20_000,
  });
  // 設定を読めなかったときも source-unreadable にする（実体の `.git` があることを別の理由で示さない）。
  return (await isPartialClone(git)) === false
    ? { git, repoPath }
    : { reason: "source-unreadable" };
};

// コミットに解決する。無い（`rev-parse --verify --quiet` の終了コード 1）なら missing、git の失敗なら failed。
const lookupCommit = async (
  git: GitRunner,
  rev: string,
): Promise<{ commit: string } | { missing: true } | { failed: true }> => {
  const parsed = await git.run([
    "rev-parse",
    "--verify",
    "--quiet",
    "--end-of-options",
    `${rev}^{commit}`,
  ]);
  if (!parsed.ok) return parsed.code === 1 ? { missing: true } : { failed: true };
  const commit = parsed.stdout.trim();
  return COMMIT_ID.test(commit) ? { commit } : { failed: true };
};

const resolveCommit = async (git: GitRunner, rev: string): Promise<string | undefined> => {
  const found = await lookupCommit(git, rev);
  return "commit" in found ? found.commit : undefined;
};

// commit id として書かれた値を、そのコミットそのものとしてだけ読む。git が hex を object id として扱うのは
// 桁数がリポジトリの形式（SHA-1 は 40、SHA-256 は 64）と合うときだけで、合わなければ名前として探し、同じ名前の
// タグや短縮した id のコミットを返す。返った id が書いた値と同じときだけ使う（違えば、そのコミットは無い）。
const lookupExactCommit = async (
  git: GitRunner,
  id: string,
): Promise<{ commit: string } | { missing: true } | { failed: true }> => {
  const found = await lookupCommit(git, id);
  if (!("commit" in found)) return found;
  return found.commit === id ? found : { missing: true };
};

/**
 * 設定の ref を、読む ref の完全な名前の候補（読む順）にする。commit id ならそのもの。
 * 短い名前を git の名前の探索（gitrevisions(7)）に任せると、refs/tags/<名前> が refs/heads・refs/remotes より
 * 先に読まれ、取り込み元に同じ名前のタグを置くだけで記録も比べもタグのコミットになる。タグは refs/tags/ と
 * 書いたときだけ読む。
 */
export const specSourceRefCandidates = (ref: string): { commit: string } | { refs: string[] } => {
  // 設定の検証は大文字の hex も受け、git も大文字の id を解決する。git が返す小文字の id と比べるので、
  // 完全な commit id に見えるときだけ小文字にそろえる（ブランチの名前の大文字小文字は変えない）。
  if (COMMIT_ID.test(ref.toLowerCase())) return { commit: ref.toLowerCase() };
  if (ref.startsWith("refs/")) return { refs: [ref] };
  return { refs: [`refs/remotes/${ref}`, `refs/heads/${ref}`] };
};

/** 解決できなかったときの案内に、読んだ ref の名前を示す。短い名前のタグは読まないので、タグの書き方も添える。 */
export const describeRefLookup = (ref: string): string => {
  const candidates = specSourceRefCandidates(ref);
  if ("commit" in candidates) return "the commit must exist in the source";
  const looked = `looked up ${candidates.refs.join(", then ")}`;
  return ref.startsWith("refs/") ? looked : `${looked}; a tag must be written as refs/tags/<name>`;
};

// 完全な ref 名を、その名前だけで引く。rev-parse は完全な名前でも、その ref が無ければ refs/tags/<名前> などへ
// 落ちるので使わない。for-each-ref の名前は前方一致（refs/heads/a は refs/heads/a/b にも当たる）なので、出力の
// ref 名が候補と完全に一致するものだけを、候補の順に拾う。ref の名前は設定の検証でワイルドカードを含まない。
const resolveSourceRef = async (
  git: GitRunner,
  ref: string,
): Promise<{ commit: string } | Unavailable> => {
  const candidates = specSourceRefCandidates(ref);
  if ("commit" in candidates) {
    const found = await lookupExactCommit(git, candidates.commit);
    if ("commit" in found) return found;
    return { reason: "missing" in found ? "ref-unresolved" : "read-failed" };
  }
  const listed = await git.run([
    "for-each-ref",
    "--format=%(objectname) %(refname)",
    "--end-of-options",
    ...candidates.refs,
  ]);
  // 読めなかったときに次の候補を見ると、リモートのブランチの代わりにローカルのブランチを読みうる。
  if (!listed.ok) return { reason: "read-failed" };
  const found = new Map(
    listed.stdout
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => [line.slice(line.indexOf(" ") + 1), line.slice(0, line.indexOf(" "))]),
  );
  const name = candidates.refs.find((candidate) => found.has(candidate));
  const id = name === undefined ? undefined : found.get(name);
  if (id === undefined) return { reason: "ref-unresolved" };
  if (!OBJECT_ID.test(id)) return { reason: "read-failed" };
  // for-each-ref が返す id はリポジトリの形式の桁数なので、名前の探索に回らずその object を指す。
  // コミットを指さない ref（tree や blob を指すタグ）は解決できないものとする。
  const peeled = await lookupCommit(git, id);
  if ("commit" in peeled) return peeled;
  return { reason: "missing" in peeled ? "ref-unresolved" : "read-failed" };
};

// コミットの中のパス（省略時はツリー全体）を比べるための値。パスが無ければ null、読めなければ undefined。
// パスは「mode type object id」にする。通常のファイルとシンボリックリンクは、中身（指す先の文字列）が同じだと
// object id も同じになるので、mode も含めて比べる（ツリーの id は子の mode を含むので、ツリー全体はそのまま）。
const objectIdAt = async (
  git: GitRunner,
  commit: string,
  entry: string | undefined,
): Promise<string | null | undefined> => {
  if (entry === undefined || entry === ".") {
    const tree = await git.run([
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${commit}^{tree}`,
    ]);
    const id = tree.ok ? tree.stdout.trim() : "";
    return OBJECT_ID.test(id) ? id : undefined;
  }
  const listed = await git.run(["ls-tree", "-z", "--full-tree", commit, "--", entry]);
  if (!listed.ok) return undefined;
  const lines = listed.stdout.split("\u0000").filter((record) => record.endsWith(`\t${entry}`));
  if (lines.length === 0) return null;
  // 同じ名前のエントリが重複した壊れた tree は、どれを比べるか決められないので読めないものとする。
  if (lines.length > 1) return undefined;
  const [mode = "", type = "", id = ""] = lines[0].split("\t")[0].split(" ");
  return ENTRY_MODE.test(mode) && ENTRY_TYPE.test(type) && OBJECT_ID.test(id)
    ? `${mode} ${type} ${id}`
    : undefined;
};

export interface SourceToRecord {
  /** 取り込み元の ref が今指すコミット。 */
  commit: string;
  /** 読んだ取り込み元のチェックアウト（絶対パス）。 */
  repoPath: string;
  /** 今の ref に無い paths（あれば記録しない）。 */
  missingPaths: string[];
  /** 取り込み元の HEAD のコミット（解決できなければ undefined）。 */
  head?: string;
  /**
   * HEAD と ref で中身が違う paths（paths を省いたときは "."）。HEAD を解決できなければ全部。
   * 作業ツリーは読まないので、コミットしていない変更は見ない。
   */
  headMismatch: string[];
}

// HEAD と ref のコミットで、paths（省略時はツリー全体）の中身を比べる。読めなければ undefined。
// ref 側は読んだ id（refIds）を使い、git の起動を paths 1 つにつき 1 回に抑える（上限は 2 * MAX_PATHS + 8）。
const pathsDifferingFromHead = async (
  git: GitRunner,
  source: SpecSource,
  commit: string,
  head: string | undefined,
  refIds: ReadonlyMap<string, string | null>,
): Promise<string[] | undefined> => {
  const entries: (string | undefined)[] = source.paths.length === 0 ? [undefined] : source.paths;
  if (head === undefined) return entries.map((entry) => entry ?? ".");
  if (head === commit) return [];
  const differing: string[] = [];
  for (const entry of entries) {
    const atRef = entry === undefined ? await objectIdAt(git, commit, entry) : refIds.get(entry);
    const atHead = await objectIdAt(git, head, entry);
    if (atHead === undefined || atRef === undefined) return undefined;
    if (atHead !== atRef) differing.push(entry ?? ".");
  }
  return differing;
};

/**
 * 記録する前に、取り込み元の ref が今指すコミット、paths がそこにあるか、HEAD と paths の中身が同じかを読む。
 * 読めなければ undefined。
 */
export const readSourceToRecord = async (
  repoRoot: string,
  source: SpecSource,
): Promise<SourceToRecord | undefined> => {
  const opened = await sourceGit(repoRoot, source);
  if (!("git" in opened)) return undefined;
  const { git } = opened;
  const resolved = await resolveSourceRef(git, source.ref);
  if (!("commit" in resolved)) return undefined;
  const { commit } = resolved;
  const refIds = new Map<string, string | null>();
  for (const entry of source.paths) {
    const id = await objectIdAt(git, commit, entry);
    if (id === undefined) return undefined;
    refIds.set(entry, id);
  }
  const missingPaths = source.paths.filter((entry) => refIds.get(entry) === null);
  const head = await resolveCommit(git, "HEAD");
  const headMismatch = await pathsDifferingFromHead(git, source, commit, head, refIds);
  if (headMismatch === undefined) return undefined;
  return {
    commit,
    repoPath: opened.repoPath,
    missingPaths,
    ...(head === undefined ? {} : { head }),
    headMismatch,
  };
};

const compareSource = async (
  git: GitRunner,
  source: SpecSource,
  recorded: string,
  current: string,
): Promise<SpecSourceResult> => {
  const base = { name: source.name, recorded, current };
  const entries: (string | undefined)[] = source.paths.length === 0 ? [undefined] : source.paths;
  const missingPaths: string[] = [];
  let outdated = false;
  for (const entry of entries) {
    const before = await objectIdAt(git, recorded, entry);
    const after = await objectIdAt(git, current, entry);
    // 読めなかったものを「同じ」と扱わない。
    if (before === undefined || after === undefined) {
      return { name: source.name, status: "unavailable", recorded, reason: "read-failed" };
    }
    if (after === null && entry !== undefined) missingPaths.push(entry);
    if (before !== after) outdated = true;
  }
  if (missingPaths.length > 0) return { ...base, status: "path-missing", missingPaths };
  return { ...base, status: outdated ? "outdated" : "current" };
};

/** 記録したコミットと取り込み元の今の ref を、paths の中で比べる。 */
export const checkSpecSources = async (
  repoRoot: string,
  sources: SpecSource[],
  recorded: Readonly<Record<string, string>>,
): Promise<SpecSourceResult[]> => {
  const results: SpecSourceResult[] = [];
  for (const source of sources) {
    const recordedCommit = Object.hasOwn(recorded, source.name) ? recorded[source.name] : undefined;
    // 記録が無いことは、取り込み元が無くても manifest だけで分かる。
    if (recordedCommit === undefined) {
      results.push({ name: source.name, status: "unrecorded" });
      continue;
    }
    // 取り込み元を読めない・ref や記録したコミットを持っていないときは、理由を付けて比べない（fetch しない）。
    const unavailable = (reason: SpecSourceUnavailableReason): SpecSourceResult => ({
      name: source.name,
      status: "unavailable",
      recorded: recordedCommit,
      reason,
    });
    const opened = await sourceGit(repoRoot, source);
    if (!("git" in opened)) {
      results.push(unavailable(opened.reason));
      continue;
    }
    const current = await resolveSourceRef(opened.git, source.ref);
    if (!("commit" in current)) {
      results.push(unavailable(current.reason));
      continue;
    }
    const recordedFound = await lookupExactCommit(opened.git, recordedCommit);
    if (!("commit" in recordedFound)) {
      results.push(unavailable("missing" in recordedFound ? "recorded-missing" : "read-failed"));
      continue;
    }
    // 同じコミットでも比べる（paths の書き誤りを「今の ref に無い」として知らせる）。
    results.push(await compareSource(opened.git, source, recordedCommit, current.commit));
  }
  return results;
};
