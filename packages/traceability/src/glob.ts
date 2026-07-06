// Minimal glob support for `layout.implGlobs`. Only `*` (single path segment
// wildcard) and `**` (any number of path segments, including zero) are
// understood — no brace expansion, no character classes. This keeps the
// package dependency-free (no `minimatch`/`fast-glob`); the templates only
// ever need patterns like `src/**/*.ts`.

const REGEX_SPECIAL = /[.+^${}()|[\]\\]/;

const escapeChar = (char: string): string =>
  REGEX_SPECIAL.test(char) ? `\\${char}` : char;

// Translates one non-"**" path segment (e.g. "*.ts", "foo") to a regex
// fragment. A run of one or more "*" collapses to a single [^/]*; every other
// character is escaped if it is regex-special.
const segmentToRegExpSource = (segment: string): string => {
  let out = '';
  let index = 0;
  while (index < segment.length) {
    if (segment[index] === '*') {
      out += '[^/]*';
      while (segment[index] === '*') {
        index += 1;
      }
      continue;
    }
    out += escapeChar(segment[index]);
    index += 1;
  }
  return out;
};

// Converts an implGlobs pattern to an anchored RegExp matched against a
// POSIX repo-relative path. "**" matches zero or more whole path segments: it
// absorbs the "/" on whichever side joins it to the rest of the pattern, so
// `src/**/*.ts` matches `src/foo.ts` as well as `src/a/b/foo.ts`, and
// `foo/**` matches everything (at any depth) under `foo/`.
export const globToRegExp = (pattern: string): RegExp => {
  const rawSegments = pattern.split('/');
  const segments = rawSegments.filter(
    (segment, index) =>
      segment !== '**' || rawSegments[index - 1] !== '**'
  );

  let source = '';
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const hasPrev = index > 0;
    const isLast = index === segments.length - 1;
    const prevWasGlobstar = hasPrev && segments[index - 1] === '**';

    if (segment === '**') {
      if (isLast) {
        source += hasPrev ? '/.*' : '.*';
      } else {
        source += hasPrev ? '/(?:[^/]+/)*' : '(?:[^/]+/)*';
      }
      continue;
    }

    if (hasPrev && !prevWasGlobstar) {
      source += '/';
    }
    source += segmentToRegExpSource(segment);
  }

  return new RegExp(`^${source}$`);
};

// The longest literal (glob-free) path prefix of `pattern`, used to limit the
// filesystem walk to the smallest subtree that can possibly contain a match
// instead of walking the whole repo for every glob. Returns "." when the
// first segment already contains a wildcard (e.g. `**/*.feature`).
export const globBaseDir = (pattern: string): string => {
  const literalSegments: string[] = [];
  for (const segment of pattern.split('/')) {
    if (segment.includes('*')) {
      break;
    }
    literalSegments.push(segment);
  }
  return literalSegments.length === 0 ? '.' : literalSegments.join('/');
};
