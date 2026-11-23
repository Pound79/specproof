// 版を上げて layout.implExcludeGlobs が使えるようになっても、利用側の設定に足さなければ、テストや
// 生成物のファイルが unregistered-impl に並び続ける。そう見えるファイルが多いときに、設定を 1 行で案内する。
// テキスト出力だけに出し、--json と終了コードには影響しない。パスは PR の作者が書けるので案内に載せない。
import type { DriftWarning } from "./check.js";

// ディレクトリ: Web のテストとモック（__tests__/・__mocks__/）。
const TEST_DIRECTORY = /(^|\/)__(tests|mocks)__\//;
// ファイル名: Web のテスト（*.test.* / *.spec.*）、Flutter のテスト（*_test.dart）と生成物
// （*.g.dart / *.freezed.dart / *.mocks.dart）。ファイル名だけに当て、末尾に固定しない形で入力の長さに線形にする。
const TEST_OR_GENERATED_NAME = [/\.(test|spec)\./, /_test\.dart$/, /\.(g|freezed|mocks)\.dart$/];

export const looksLikeTestOrGenerated = (relPath: string): boolean => {
  if (TEST_DIRECTORY.test(relPath)) return true;
  const name = relPath.slice(relPath.lastIndexOf("/") + 1);
  return TEST_OR_GENERATED_NAME.some((pattern) => pattern.test(name));
};

const HINT_THRESHOLD = 5;

const isTestLikeImpl = (warning: DriftWarning): boolean =>
  warning.kind === "unregistered-impl" &&
  warning.path !== undefined &&
  looksLikeTestOrGenerated(warning.path);

/**
 * テキスト出力の一覧から、テストや生成物に見える unregistered-impl を外す。数百件あると drift などの見るべき
 * 出力が埋もれるため。--json と終了コードには使わない（呼び出し側がテキストと注釈にだけ使う）。
 */
export const withoutTestLikeImpl = (
  warnings: DriftWarning[],
): { listed: DriftWarning[]; hiddenCount: number } => {
  const listed = warnings.filter((warning) => !isTestLikeImpl(warning));
  return { listed, hiddenCount: warnings.length - listed.length };
};

export const describeHiddenTestLikeImpl = (
  hiddenCount: number,
  implExcludeGlobs: readonly string[] | undefined,
): string | undefined => {
  if (hiddenCount === 0) return undefined;
  const config =
    implExcludeGlobs === undefined
      ? "set layout.implExcludeGlobs to stop counting them"
      : "widen layout.implExcludeGlobs to stop counting them";
  return `(${hiddenCount} unregistered-impl item(s) that look like tests or generated files are not listed; run with --include-tests to list them (--json always includes them), or ${config} — see docs/config-schema.md)`;
};

export const describeImplExcludeHint = (
  warnings: DriftWarning[],
  implExcludeGlobs: readonly string[] | undefined,
): string | undefined => {
  if (implExcludeGlobs !== undefined) return undefined;
  const count = warnings.filter(
    (warning) =>
      warning.kind === "unregistered-impl" &&
      warning.path !== undefined &&
      looksLikeTestOrGenerated(warning.path),
  ).length;
  if (count < HINT_THRESHOLD) return undefined;
  return `(${count} unregistered-impl item(s) look like tests or generated files; to keep them out of this list, set layout.implExcludeGlobs — see docs/config-schema.md)`;
};
