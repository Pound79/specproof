import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Sentinel hash values. They can never collide with a hex sha256 digest,
// so a stored sentinel vs computed digest (or vice versa) always reads as drift.
export const FILE_MISSING = 'FILE_MISSING';
export const SECTION_MISSING = 'SECTION_MISSING';

const sha256 = (content: string): string =>
  createHash('sha256').update(content, 'utf8').digest('hex');

export const readFileOrNull = async (
  absPath: string
): Promise<string | null> => {
  try {
    return await readFile(absPath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return null;
    }
    throw error;
  }
};

export const computeFileHash = async (absPath: string): Promise<string> => {
  const content = await readFileOrNull(absPath);
  return content === null ? FILE_MISSING : sha256(content);
};

// Marker that bdd-bootstrap writes into a draft .feature. Its presence in a
// file under featuresDir means a draft was promoted without the mandatory human
// review — the reviewer deletes the marker as the explicit "I have inscribed
// intent" action. It is a Gherkin comment, so every runner ignores it.
export const DRAFT_MARKER = '# bdd-kit: draft';

// True when `content` has the draft marker as a whole line (position-independent;
// leading/trailing whitespace and CRLF tolerated, but a longer comment that
// merely starts with the marker does not count). Detection is deliberately
// permissive — this is a firewall that should catch any promoted draft.
export const containsDraftMarker = (content: string): boolean =>
  content.split('\n').some((line) => line.trim() === DRAFT_MARKER);

// File-reading wrapper of containsDraftMarker. bootstrap writes the marker near
// the top of a draft, after any `# language:` directive. A missing file is not
// a draft.
export const hasDraftMarker = async (absPath: string): Promise<boolean> => {
  const content = await readFileOrNull(absPath);
  return content !== null && containsDraftMarker(content);
};

// A markdown fenced-code delimiter per CommonMark §4.5: 0-3 leading spaces,
// then a run of 3+ backticks or 3+ tildes. `char` is the fence character and
// `len` its run length; `bare` is true when nothing but whitespace follows
// (an info string is allowed on the opening fence but not the closing one).
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

const parseFence = (
  line: string
): { char: string; len: number; bare: boolean } | null => {
  const match = line.match(FENCE_RE);
  if (match === null) {
    return null;
  }
  const run = match[1];
  return { char: run[0], len: run.length, bare: match[2].trim() === '' };
};

// The ATX heading level of a line (the count of leading `#`, 1-6) when it is a
// heading (a `#`-run followed by a space), else null.
const headingLevelOf = (line: string): number | null => {
  const match = line.match(/^(#{1,6}) /);
  return match === null ? null : match[1].length;
};

// Extracts the markdown block from the `<level> <heading>` line (default level
// 2 = `## `) up to (but not including) the next heading of level <= `level`,
// then hashes it. Editing other sections of the same document therefore does not
// register as drift for this link. `level` lets a link point at a `###` (or
// deeper) section instead of permanently returning SECTION_MISSING. For the
// common single-`#`-title doc, level 2 behaves exactly as before.
//
// `level` must be an integer in 1-6 (the ATX heading range). It is validated
// here because this is a public API: manifest loading already range-checks
// `headingLevel`, but a direct caller passing e.g. 2.5 ('#'.repeat truncates),
// 0/7 (a prefix that can never match) or -1 ('#'.repeat throws) would otherwise
// fail confusingly. Fail fast with a clear message instead.
//
// Lines inside fenced code blocks are skipped, so a `#`-prefixed line in a code
// example neither ends the section early (false positive) nor gets matched as
// the heading (false negative). Fences follow CommonMark: a block opened with
// one delimiter (``` or ~~~, run length N) is closed only by a bare run of the
// SAME character of length >= N. A single continuous scan keeps the fence state
// intact across the heading, avoiding any reset hazard.
export const computeHeadingSectionHash = async (
  absPath: string,
  heading: string,
  level = 2
): Promise<string> => {
  if (!Number.isInteger(level) || level < 1 || level > 6) {
    throw new Error(
      `computeHeadingSectionHash: level must be an integer in 1-6 (got ${level})`
    );
  }
  const content = await readFileOrNull(absPath);
  if (content === null) {
    return FILE_MISSING;
  }

  const lines = content.split('\n');
  const headingLine = `${'#'.repeat(level)} ${heading}`;

  let openFence: { char: string; len: number } | null = null;
  let start = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = parseFence(line);

    if (openFence !== null) {
      const closesFence =
        fence !== null &&
        fence.char === openFence.char &&
        fence.len >= openFence.len &&
        fence.bare;
      if (closesFence) {
        openFence = null;
      }
      continue;
    }

    if (fence !== null) {
      openFence = { char: fence.char, len: fence.len };
      continue;
    }

    if (start === -1) {
      if (line.trimEnd() === headingLine) {
        start = index;
      }
    } else {
      const lineLevel = headingLevelOf(line);
      if (lineLevel !== null && lineLevel <= level) {
        return sha256(lines.slice(start, index).join('\n'));
      }
    }
  }

  if (start === -1) {
    return SECTION_MISSING;
  }
  return sha256(lines.slice(start).join('\n'));
};
