import path from "node:path";
import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { printable } from "./display-text.js";
import {
  CONFIG_FILENAMES,
  entryExists,
  findConfigFileName,
  isMapping,
  parseConfigFile,
  readConfigText,
} from "./config-file.js";

// The conventional manifest name; also a root marker when no config file is found first.
const MANIFEST_MARKER = "traceability.yaml";

// Files that mark a directory as the repo root, in precedence order.
const ROOT_MARKERS = [...CONFIG_FILENAMES, MANIFEST_MARKER];

// 改名（bdd-kit → specproof、0.2.0）前の設定ファイル名。0.4.0 で読むのをやめた。黙って無視すると
// 置いた設定が効かないまま検査が通るので、現行の目印が無い段にこれがあれば名前の変更を案内して止める。
const REMOVED_CONFIG_FILENAMES = ["bdd-kit.config.yaml", "bdd-kit.config.yml"];

/** `dir` に旧名の設定ファイルがあれば、名前の変更を案内して止める。 */
export const assertNoRemovedConfig = (dir: string): void => {
  for (const name of REMOVED_CONFIG_FILENAMES) {
    if (entryExists(path.join(dir, name))) {
      throw new Error(`${name} is no longer read; rename it to specproof.config.yaml`);
    }
  }
};

// MSYS / Git Bash returns paths like /c/Users/... — convert to C:/Users/...
// before handing to path.resolve, which would otherwise interpret /c as a
// directory off the current drive root on Windows.
export const normalizeMsysPath = (p: string): string => {
  if (process.platform !== "win32") return p;
  const m = /^\/([a-zA-Z])(\/.*)?$/.exec(p);
  return m ? `${m[1].toUpperCase()}:${m[2] ?? "/"}` : p;
};

/** 設定ファイルの `layout.manifest` を、その設定ファイルのあるディレクトリ基準の絶対パスにする。
 *  読めない・書かれていないときは undefined（従来どおり manifest のあるディレクトリをルートにする）。 */
const configuredManifestPath = (configDir: string, name: string): string | undefined => {
  try {
    const layout = parseConfigFile(name, readConfigText(configDir, name)).layout;
    if (!isMapping(layout) || typeof layout.manifest !== "string" || layout.manifest === "") {
      return undefined;
    }
    return path.resolve(configDir, layout.manifest);
  } catch {
    return undefined;
  }
};

/** git のリポジトリの最上段（`.git` がある段）か。上への探索をここで止める。 */
const isRepositoryTop = (dir: string): boolean => entryExists(path.join(dir, ".git"));

/** 旧名の設定ファイルの項目があるか（リンク切れも「ある」とみなす）。 */
const hasRemovedConfigEntry = (dir: string): boolean =>
  REMOVED_CONFIG_FILENAMES.some((name) => entryExists(path.join(dir, name)));

/** 現行名か旧名の設定ファイルの項目があるか（リンク切れも「ある」とみなす）。 */
const hasConfigEntry = (dir: string): boolean =>
  findConfigFileName(dir) !== undefined || hasRemovedConfigEntry(dir);

/**
 * `manifestDir` の traceability.yaml を `layout.manifest` で指す設定ファイルが上の階層にあれば、
 * そのディレクトリを返す。manifest をサブディレクトリ（例: `e2e/traceability.yaml`）に置き、
 * そこから CLI を流したときに、サブディレクトリをルートと取り違えて全参照を missing にしないため。
 * 最も近い設定ファイルだけを見る。それが別の manifest を指すなら従来どおり manifest の段をルートにする。
 * `.git` のある段より上は見ない（チェックアウトの外に置かれた設定ファイルでルートを広げさせない）。
 * manifest の段に設定ファイルの項目（リンク切れ・旧名を含む）があれば親へ移らない。移すとその段の
 * 設定は読まれず、リンク切れや旧名の検出（readConfigFile / assertNoRemovedConfig）を素通りするため。
 * 途中の段の旧名の設定ファイルも同じ理由で、親の設定ファイルを採らない。
 */
const findOwningConfigDir = (manifestDir: string): string | undefined => {
  const manifestFile = path.join(manifestDir, MANIFEST_MARKER);
  let dir = manifestDir;
  if (hasConfigEntry(dir) || isRepositoryTop(dir)) return undefined;
  for (let parent = path.dirname(dir); parent !== dir; parent = path.dirname(dir)) {
    dir = parent;
    const name = findConfigFileName(dir);
    if (name !== undefined) {
      return configuredManifestPath(dir, name) === manifestFile ? dir : undefined;
    }
    if (hasRemovedConfigEntry(dir) || isRepositoryTop(dir)) return undefined;
  }
  return undefined;
};

/** 中身の無い .git（空のディレクトリ、リンク切れの symlink）か。取り除いても履歴を失わない場合だけ true。 */
const isHollowGitEntry = (gitDir: string): boolean => {
  try {
    const entry = lstatSync(gitDir);
    if (entry.isSymbolicLink() && !existsSync(gitDir)) return true;
    return statSync(gitDir).isDirectory() && readdirSync(gitDir).length === 0;
  } catch {
    return false;
  }
};

// git の stderr から理由に添える長さの上限。
const GIT_REASON_MAX = 200;

/**
 * 境界の .git を Git で確かめられなかった理由と対処を組み立てる。`rejection` は git が起動して
 * 終わったときの終了コードと stderr。中身の無い .git のときだけ取り除く案内をする（中身がある .git は
 * 設定や Git の版の違いでも退けられ、取り除くと履歴を失いうるため原因を決めつけない）。
 */
const describeGitFailure = (
  gitDir: string,
  rejection: { status: number; stderr: string } | undefined,
): string => {
  const quoted = `"${gitDir}"`;
  if (rejection === undefined) {
    return `could not get an answer from git to verify ${quoted}; pass --root`;
  }
  if (isHollowGitEntry(gitDir)) {
    return `${quoted} is empty or a broken link, so Git cannot use it; fix or remove it, or pass --root`;
  }
  const firstLine = rejection.stderr
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .find((line) => line !== "");
  const detail =
    firstLine === undefined ? "" : `: ${printable(firstLine.slice(0, GIT_REASON_MAX))}`;
  return (
    `git rejected ${quoted} (exit ${rejection.status})${detail}; ` +
    "check the repository and your Git config, or pass --root"
  );
};

/**
 * Resolves the repo root by walking up from `startDir` (default
 * `process.cwd()`) looking for a specproof config or a traceability
 * manifest, then falling back to
 * `git rev-parse --show-toplevel`. A config file wins over a bare manifest:
 * when the first marker found is `traceability.yaml` and the nearest config
 * file above it names that file in `layout.manifest`, the config's directory
 * is the root. Throws when neither strategy resolves.
 *
 * A directory on the way up that has no marker but holds a removed
 * `bdd-kit.config.*` name stops with a rename message instead of being passed
 * over (the config placed there would otherwise be ignored silently).
 *
 * 親へたどる探索は、`.git` の項目（ディレクトリだけでなく、submodule や
 * `git worktree` の `gitdir: ...` を書いたファイルも含む）がある段で止まる。
 * その段の設定ファイル・manifest・旧名の検出までは見て、より上の段は見ない。
 * マーカーが無ければ、その段の .git と作業ツリーを指定して Git に確かめる。
 * チェックアウトの外に置かれた設定でルートを広げさせないため。Git がその .git を
 * 退けたときは .git のパスを示すエラーにする。取り除く案内は中身の無い .git
 * （空のディレクトリ・リンク切れ）のときだけで、それ以外は git の終了コードと
 * stderr の 1 行目を添え、リポジトリと Git の設定を確かめるか --root を渡すよう
 * 案内する。git を起動できない・応答が無いときは --root を渡すよう案内する。
 *
 * Unlike the original monorepo implementation this does NOT resolve relative to
 * the module location: the package is published and installed under an
 * arbitrary `node_modules` path, so only the consumer's cwd / git tree is
 * meaningful.
 */
export const resolveRepoRoot = (startDir: string = process.cwd()): string => {
  const initialDir = path.resolve(startDir);
  let dir = initialDir;
  let gitBoundary: string | undefined;
  for (;;) {
    if (CONFIG_FILENAMES.some((name) => existsSync(path.join(dir, name)))) {
      return dir;
    }
    if (existsSync(path.join(dir, MANIFEST_MARKER))) {
      return findOwningConfigDir(dir) ?? dir;
    }
    assertNoRemovedConfig(dir);
    const parent = path.dirname(dir);
    if (isRepositoryTop(dir)) {
      gitBoundary = dir;
      break;
    }
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  // git が起動して終わったときの終了コードと stderr。未導入・時間切れ・signal では undefined のまま。
  let rejection: { status: number; stderr: string } | undefined;
  try {
    // Git の自動探索は空の .git を飛ばし、受け継いだ GIT_DIR も優先する。
    // 見つけた境界そのものを検証し、別のリポジトリへのフォールバックを防ぐ。
    const location =
      gitBoundary === undefined
        ? []
        : [`--git-dir=${path.join(gitBoundary, ".git")}`, `--work-tree=${gitBoundary}`];
    const top = execFileSync("git", [...location, "rev-parse", "--show-toplevel"], {
      cwd: initialDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    }).trim();
    if (top) {
      return path.resolve(normalizeMsysPath(top));
    }
    rejection = { status: 0, stderr: "" };
  } catch (error) {
    // fall through to the explicit error below
    const { status, signal, stderr } = error as {
      status?: unknown;
      signal?: unknown;
      stderr?: unknown;
    };
    if (typeof status === "number" && signal == null) {
      rejection = { status, stderr: typeof stderr === "string" ? stderr : "" };
    }
  }

  const markers = ROOT_MARKERS.join(" / ");
  const manifestHint = "(and --manifest for a non-default manifest).";
  if (gitBoundary !== undefined) {
    // 探索は境界で止めている。全ての親を見たとは書かず、原因の .git を示す。
    const gitDir = path.join(gitBoundary, ".git");
    throw new Error(
      `Could not resolve a repo root from "${startDir}": found no ${markers} ` +
        `up to the Git boundary, and ${describeGitFailure(gitDir, rejection)} ` +
        `explicitly ${manifestHint}`,
    );
  }
  throw new Error(
    `Could not resolve a repo root from "${startDir}": found no ` +
      `${markers} in any ancestor directory, and ` +
      "git rev-parse did not return a repository root. Pass --root explicitly " +
      manifestHint,
  );
};

/** The conventional manifest location at the repo root. */
export const resolveDefaultManifestPath = (repoRoot: string): string =>
  path.join(repoRoot, "traceability.yaml");
