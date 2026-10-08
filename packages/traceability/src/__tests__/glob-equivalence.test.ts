import { describe, expect, it } from "vitest";
import { compileGlob } from "../glob.js";

// 照合方式を正規表現から動的計画法に替えたので、意味が変わっていないことを旧実装と比べる。
// 旧実装（正規表現への変換）をここに写して基準にする。入力は短くし、旧実装でも
// バックトラッキングが問題にならない範囲に限る。
const REGEX_SPECIAL = /[.?+^${}()|[\]\\]/;
const legacyGlobToRegExp = (pattern: string): RegExp => {
  const rawSegments = pattern.replace(/^(?:\.\/)+/, "").split("/");
  const segments = rawSegments.filter(
    (segment, index) => segment !== "**" || rawSegments[index - 1] !== "**",
  );
  let source = "";
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const hasPrev = index > 0;
    const isLast = index === segments.length - 1;
    const prevWasGlobstar = hasPrev && segments[index - 1] === "**";
    if (segment === "**") {
      source += isLast ? (hasPrev ? "/.*" : ".*") : hasPrev ? "/(?:[^/]+/)*" : "(?:[^/]+/)*";
      continue;
    }
    if (hasPrev && !prevWasGlobstar) source += "/";
    let out = "";
    for (let i = 0; i < segment.length; ) {
      if (segment[i] === "*") {
        out += "[^/]*";
        while (segment[i] === "*") i += 1;
        continue;
      }
      out += REGEX_SPECIAL.test(segment[i]) ? `\\${segment[i]}` : segment[i];
      i += 1;
    }
    source += out;
  }
  return new RegExp(`^${source}$`);
};

const PATTERNS = [
  "src/**/*.ts",
  "**/*.feature",
  "foo/**",
  "src/*.ts",
  "src/a.b+c/*.ts",
  "**",
  "*.ts",
  "src/**",
  "a/**/b/**/c.ts",
  "**/x/**",
  "src/file?.ts",
  "./src/**/*.ts",
  "src/**/**/*.ts",
  "*a*b.ts",
  "src/main.ts",
  "**/**",
  "a/*/c",
  "a/**/c",
  "*",
];

const PATHS = [
  "src/main.ts",
  "src/a/b/main.ts",
  "src/main.tsx",
  "lib/main.ts",
  "foo",
  "foo/bar",
  "foo/bar/baz.ts",
  "src/a.b+c/x.ts",
  "src/aXbc/x.ts",
  "a/c",
  "a/b/c",
  "a/b/b/c.ts",
  "a/x/b/y/c.ts",
  "a/b/c.ts",
  "x/y",
  "q/x/y",
  "x",
  "src/file?.ts",
  "src/fileX.ts",
  "aab.ts",
  "ab.ts",
  "b.ts",
  "main.ts",
  "dir/main.ts",
  "src",
];

describe("compileGlob は旧来の正規表現と同じ意味を保つ", () => {
  for (const pattern of PATTERNS) {
    it(pattern, () => {
      const legacy = legacyGlobToRegExp(pattern);
      const matcher = compileGlob(pattern);
      const differences = PATHS.filter((path) => legacy.test(path) !== matcher.test(path));
      expect(differences).toEqual([]);
    });
  }
});
