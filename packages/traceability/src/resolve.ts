import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

const physicalRootOf = (root: string, repoRoot: string): string => {
  try {
    return realpathSync(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Repository root does not exist: ${repoRoot}`);
    }
    throw error;
  }
};

/** 存在する最長の祖先を realpath で解決し、未作成の残りをそのまま連結する。 */
const physicalPathOf = (target: string): string => {
  const missing: string[] = [];
  let existing = target;
  for (;;) {
    try {
      return path.join(realpathSync(existing), ...[...missing].reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const parent = path.dirname(existing);
      if ((code !== "ENOENT" && code !== "ENOTDIR") || parent === existing) throw error;
      missing.push(path.basename(existing));
      existing = parent;
    }
  }
};

/** repo 外・リンク切れ・確かめられないリンク先を、区別せずに同じ文言で拒否する。 */
const outsideRootError = (refPath: string): Error =>
  new Error(
    `Manifest path ${JSON.stringify(refPath)} is dangling or resolves outside the repository root.`,
  );

const physicalPathOrUndefined = (target: string): string | undefined => {
  try {
    return physicalPathOf(target);
  } catch {
    return undefined;
  }
};

// Resolves a manifest-relative path against the repo root and guarantees the
// result stays inside the root. Guards against hand-edit mistakes (and the odd
// malicious entry) where `ref.path` is `../something` or an absolute path that
// would make the drift check read files outside the repository.
export const resolveWithinRoot = (repoRoot: string, refPath: string): string => {
  const root = path.resolve(repoRoot);
  let resolved = path.resolve(root, refPath);
  // path.relative-based containment, so a sibling like `/repo/root-evil` is not
  // mistaken for being inside `/repo/root`.
  if (!isWithin(root, resolved)) {
    // cwd は物理パスなので、symlink 経由の root と相対 --manifest の組み合わせは
    // 字句上は外に見える。絶対パスに限り、実体で比べ直して root 側の表記へ戻す。
    // 相対の `../` 参照は実体が中にあっても従来どおり拒否する。
    // repo 外のパスで起きた権限やループのエラーはそのまま出さず、同じ文言で拒否する
    // （CI のログから runner 上のパスの状態を推測させない）。
    // 実体の root の字句上の内側なら realpath せずに root 側の表記へ写し、下の要素ごとの
    // 検査に任せる（root を物理パスで渡した場合と同じ結果になる）。
    if (!path.isAbsolute(refPath)) throw outsideRootError(refPath);
    const physicalRoot = physicalRootOf(root, repoRoot);
    const physical = isWithin(physicalRoot, resolved)
      ? resolved
      : physicalPathOrUndefined(resolved);
    if (physical === undefined || !isWithin(physicalRoot, physical)) {
      throw outsideRootError(refPath);
    }
    resolved = path.join(root, path.relative(physicalRoot, physical));
  }

  const physicalRoot = physicalRootOf(root, repoRoot);

  let current = root;
  const relative = path.relative(root, resolved);
  for (const part of relative === "" ? [] : relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      lstatSync(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") break;
      throw error;
    }

    // 直前の要素までは repo 内と確認済みなので、ここで realpath が失敗するのは
    // current 自体がリンクの場合だけ。リンク先が repo 外のとき、存在・権限・ループの
    // 違いをエラー文から区別させないよう、失敗も外向きも同じ文言にする。
    let physicalCurrent: string | undefined;
    try {
      physicalCurrent = realpathSync(current);
    } catch {
      physicalCurrent = undefined;
    }
    // CLI が出すスタックからも区別させないよう、エラーの生成箇所をそろえる。
    if (physicalCurrent === undefined || !isWithin(physicalRoot, physicalCurrent)) {
      throw outsideRootError(refPath);
    }
  }
  return resolved;
};
