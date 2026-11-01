// 雛形の .gitignore のうち、漏れると秘密や認証済みの状態が追跡されうる除外。値はディレクトリか。
// 雛形に書かれた行だけを求めるので、adapter ごとの一覧は持たない（flutter は .env / .env.* / .npmrc）。
const SENSITIVE_GITIGNORE_ENTRIES = new Map([
  [".env", false],
  [".env.*", false],
  [".npmrc", false],
  ["playwright/.auth", true],
  ["test-results", true],
  ["playwright-report", true],
]);

interface Pattern {
  readonly negated: boolean;
  readonly name: string;
  readonly directoryOnly: boolean;
}

// git の規則のうち、行の文字列を比べるのに要る分だけを扱う。glob の意味までは解かないので、
// `.env*` は `.env` と `.env.*` の代わりとはみなさない。
// - 空行と # の行は飛ばす。末尾の空白は除き、先頭の空白は模様の一部として残す。
// - 先頭の ! は否定。後の行の否定は、それより前の同じ除外を打ち消す。
// - 先頭の / は外す（.gitignore のあるディレクトリに固定するだけで、雛形の置き場所と同じ）。
// - 末尾の / はディレクトリだけに効く印として覚える。
const patternsOf = (text: string): Pattern[] =>
  text.split(/\r?\n/).flatMap((raw) => {
    const line = raw.replace(/\s+$/, "");
    if (line === "" || line.startsWith("#")) return [];
    const negated = line.startsWith("!");
    const body = (negated ? line.slice(1) : line).replace(/^\//, "");
    const directoryOnly = body.endsWith("/");
    return [{ negated, name: directoryOnly ? body.replace(/\/+$/, "") : body, directoryOnly }];
  });

/**
 * 雛形の .gitignore にある機密の除外のうち、既存の .gitignore で除外されていないもの。
 * 雛形での順に返す。親ディレクトリの .gitignore は見ない。
 */
export const missingSensitiveEntries = (templateText: string, existingText: string): string[] => {
  // 名前ごとに、最後に効いている除外（ディレクトリだけに効くか）を残す。
  const excluded = new Map<string, boolean>();
  for (const pattern of patternsOf(existingText)) {
    if (pattern.negated) excluded.delete(pattern.name);
    else excluded.set(pattern.name, (excluded.get(pattern.name) ?? true) && pattern.directoryOnly);
  }
  return patternsOf(templateText)
    .filter((pattern) => !pattern.negated && SENSITIVE_GITIGNORE_ENTRIES.has(pattern.name))
    .map((pattern) => pattern.name)
    .filter((name) => {
      const directoryOnly = excluded.get(name);
      if (directoryOnly === undefined) return true;
      // ディレクトリだけに効く除外（.env/ など）は、ファイルの項目を除外しない。
      return directoryOnly && SENSITIVE_GITIGNORE_ENTRIES.get(name) === false;
    });
};
