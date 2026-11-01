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
// - 空行と # の行は飛ばす。末尾のスペースは除き（タブは残す）、先頭の空白は模様の一部として残す。
// - 先頭の ! は否定。後の行の否定は、それより前の同じ除外を打ち消す。
// - 先頭の / は外す（.gitignore のあるディレクトリに固定するだけで、雛形の置き場所と同じ）。
// - 末尾の / はディレクトリだけに効く印として覚える。
// 末尾の char を、後ろから走査して線形の時間で落とす（/\s+$/ は空白の長い連なりのあとに
// 別の文字があると 2 乗の時間がかかる）。git が無視する末尾の空白はスペースだけで、タブは残す。
const withoutTrailing = (text: string, char: string): string => {
  let end = text.length;
  while (end > 0 && text[end - 1] === char) end -= 1;
  return text.slice(0, end);
};

const patternsOf = (text: string): Pattern[] =>
  text.split(/\r?\n/).flatMap((raw) => {
    const line = withoutTrailing(raw, " ");
    if (line === "" || line.startsWith("#")) return [];
    const negated = line.startsWith("!");
    const body = (negated ? line.slice(1) : line).replace(/^\//, "");
    const directoryOnly = body.endsWith("/");
    return [{ negated, name: directoryOnly ? withoutTrailing(body, "/") : body, directoryOnly }];
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
