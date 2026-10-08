// Minimal glob support for `layout.implGlobs`. Only `*` (single path segment
// wildcard) and `**` (any number of path segments) are understood — no brace
// expansion, no character classes, and `?` is a literal character. This keeps
// the package dependency-free (no `minimatch`/`fast-glob`); the templates only
// ever need patterns like `src/**/*.ts`.
//
// implGlobs は PR で変更できる設定なので、照合は正規表現を使わずに計算量の上限がある
// 方法で行う。`*` を [^/]* に変換した正規表現は、繰り返しと末尾の不一致の組み合わせで
// バックトラッキングが爆発し、CI を止められた。

/** パスに一致するかを判定する照合器。 */
export interface GlobMatcher {
  test(path: string): boolean;
}

const normalizeGlob = (pattern: string): string => pattern.replace(/^(?:\.\/)+/, "");

/** 1 つのセグメント内の照合。`*` は `/` 以外の任意の列。O(パターン長 × 名前長)。 */
const matchSegment = (pattern: string, name: string): boolean => {
  let p = 0;
  let n = 0;
  let starAt = -1;
  let resumeAt = 0;
  while (n < name.length) {
    if (p < pattern.length && pattern[p] === "*") {
      starAt = p;
      resumeAt = n;
      p += 1;
    } else if (p < pattern.length && pattern[p] === name[n]) {
      p += 1;
      n += 1;
    } else if (starAt !== -1) {
      p = starAt + 1;
      resumeAt += 1;
      n = resumeAt;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === "*") p += 1;
  return p === pattern.length;
};

/**
 * implGlobs のパターンを照合器にする。`**` はパス区切りをまたいで 0 個以上のセグメントに
 * 一致する。ただし末尾の `foo/**` は `foo/` 配下（1 個以上）だけに一致し、パターン全体が
 * `**` なら任意のパスに一致する。セグメント単位の動的計画法で、計算量は
 * O(パターンのセグメント数 × パスのセグメント数 × セグメント内の照合) に収まる。
 */
export const compileGlob = (pattern: string): GlobMatcher => {
  const raw = normalizeGlob(pattern).split("/");
  const segments = raw.filter((segment, index) => segment !== "**" || raw[index - 1] !== "**");
  const lastIndex = segments.length - 1;

  return {
    test(candidate: string): boolean {
      const parts = candidate.split("/");
      // reachable[s] = ここまでのパターンのセグメントで、パスの先頭 s セグメントに一致できるか。
      let reachable: boolean[] = Array.from({ length: parts.length + 1 }, (_, s) => s === 0);
      for (let i = 0; i < segments.length; i += 1) {
        const segment = segments[i];
        const next: boolean[] = reachable.map(() => false);
        if (segment === "**") {
          // 末尾の `x/**` は 1 個以上、それ以外は 0 個以上のセグメントを吸収する。
          const minimum = i === lastIndex && i > 0 ? 1 : 0;
          let earliest = -1;
          for (let s = 0; s <= parts.length; s += 1) {
            if (earliest === -1 && reachable[s]) earliest = s;
            if (earliest !== -1 && s - earliest >= minimum) next[s] = true;
          }
        } else {
          for (let s = 0; s < parts.length; s += 1) {
            if (reachable[s] && matchSegment(segment, parts[s])) next[s + 1] = true;
          }
        }
        reachable = next;
      }
      return reachable[parts.length];
    },
  };
};

// The longest literal (glob-free) path prefix of `pattern`, used to limit the
// filesystem walk to the smallest subtree that can possibly contain a match
// instead of walking the whole repo for every glob. Returns "." when the
// first segment already contains a wildcard (e.g. `**/*.feature`).
export const globBaseDir = (pattern: string): string => {
  const literalSegments: string[] = [];
  const segments = normalizeGlob(pattern).split("/");
  for (const segment of segments) {
    if (segment.includes("*")) {
      break;
    }
    literalSegments.push(segment);
  }
  // 完全リテラルはファイル名までを base とせず、親から探索する。
  if (literalSegments.length === segments.length) literalSegments.pop();
  return literalSegments.length === 0 ? "." : literalSegments.join("/");
};
