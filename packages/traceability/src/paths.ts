import path from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
 * Unlike the original monorepo implementation this does NOT resolve relative to
 * the module location: the package is published and installed under an
 * arbitrary `node_modules` path, so only the consumer's cwd / git tree is
 * meaningful.
 */
export const resolveRepoRoot = (startDir: string = process.cwd()): string => {
  const initialDir = path.resolve(startDir);
  let dir = initialDir;
  for (;;) {
    if (CONFIG_FILENAMES.some((name) => existsSync(path.join(dir, name)))) {
      return dir;
    }
    if (existsSync(path.join(dir, MANIFEST_MARKER))) {
      return findOwningConfigDir(dir) ?? dir;
    }
    assertNoRemovedConfig(dir);
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: initialDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    if (top) {
      return path.resolve(normalizeMsysPath(top));
    }
  } catch {
    // fall through to the explicit error below
  }

  throw new Error(
    `Could not resolve a repo root from "${startDir}": found no ` +
      `${ROOT_MARKERS.join(" / ")} in any ancestor directory, and ` +
      "git rev-parse did not return a repository root. Pass --root explicitly " +
      "(and --manifest for a non-default manifest).",
  );
};

/** The conventional manifest location at the repo root. */
export const resolveDefaultManifestPath = (repoRoot: string): string =>
  path.join(repoRoot, "traceability.yaml");
