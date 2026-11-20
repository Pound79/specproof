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
