import {
  hasLineTerminator,
  parseFence,
  scanBlocks,
  type BlockScan,
  type CommentBlock,
} from "./markdown-blocks.js";
import { createHash } from "node:crypto";
import path from "node:path";
import { readRegularFile } from "./bounded-read.js";

// Sentinel hash values. They can never collide with a hex sha256 digest,
// so a stored sentinel vs computed digest (or vice versa) always reads as drift.
export const FILE_MISSING = "FILE_MISSING";
export const SECTION_MISSING = "SECTION_MISSING";

export const isSentinel = (hash: string): boolean =>
  hash === FILE_MISSING || hash === SECTION_MISSING;

// A missing file/section must always be reported, even when the stored hash is
// already the same sentinel (e.g. a hand-edited manifest). Only a matching
// real digest counts as clean. check と update（--spec-ref の impl の判定）で共有する。
export const isClean = (storedHash: string, currentHash: string): boolean =>
  storedHash === currentHash && !isSentinel(currentHash);
// manifest に新しく足した参照の仮の hash（specproof-new-feature が書き、specproof-update が実際の
// digest で上書きする）。これも sha256 の 16 進とは衝突しない。
export const PENDING_HASH = "PENDING";

const sha256 = (content: string): string =>
  createHash("sha256").update(content, "utf8").digest("hex");

const BOM = "﻿";

// Strips a leading UTF-8 BOM and normalizes CRLF to LF. Every content read in
// this package funnels through readFileOrNull, so this is the single point
// where hashing, heading parsing, draft-marker detection and feature-scan all
// become invariant to line-ending style and BOM presence (Windows / autocrlf
// checkouts no longer produce spurious drift). This is a breaking change for
// any manifest with hashes blessed against CRLF content — see CHANGELOG.
const normalizeContent = (content: string): string =>
  (content.startsWith(BOM) ? content.slice(BOM.length) : content).replace(/\r\n/g, "\n");

// spec・実装・feature の本体は PR の作者が書けるので、manifest と同じ上限で読む。FIFO や
// デバイスを開いて待ち続けたり、1 つの巨大なファイルでメモリを使い切ったりさせない。上限は
// ファイルごとで、合計は制限しない（同時に読むのは 32 件まで）。エラー文は公開の CI ログに
// 出るので、実行環境の配置が分かる絶対パスでなくファイル名だけにする。
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

export const readFileOrNull = async (absPath: string): Promise<string | null> => {
  try {
    const content = await readRegularFile(absPath, MAX_SOURCE_BYTES, {
      tooLarge: () => new Error(`${path.basename(absPath)}: file exceeds 8 MiB`),
      notRegular: () => new Error(`${path.basename(absPath)}: expected a regular file`),
    });
    return normalizeContent(content.toString("utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return null;
    }
    throw error;
  }
};

/** ファイルから読んだときと同じ正規化（BOM・CRLF）を、ほかから得た中身に当てる。 */
export const normalizeSourceContent = (content: string): string => normalizeContent(content);

/** computeFileHash と同じ hash を、正規化済みの中身から計算する。 */
export const hashFileContent = (content: string): string => sha256(content);

export const computeFileHash = async (absPath: string): Promise<string> => {
  const content = await readFileOrNull(absPath);
  return content === null ? FILE_MISSING : sha256(content);
};

// Marker that specproof-bootstrap writes into a draft .feature. Its presence
// in a file under featuresDir means a draft was promoted without the
// mandatory human review — the reviewer deletes the marker as the explicit
// "I have inscribed intent" action. It is a Gherkin comment, so every runner
// ignores it.
export const DRAFT_MARKER = "# specproof: draft";

// Pre-rename marker (bdd-kit → specproof). Detected permanently, unlike the
// removed bdd-kit config names: dropping it would let a draft written before
// the rename pass as reviewed. Generation (specproof-bootstrap) only ever
// writes the current DRAFT_MARKER.
export const LEGACY_DRAFT_MARKER = "# bdd-kit: draft";

// True when `content` has the draft marker (current or legacy) as a whole
// line (position-independent; leading/trailing whitespace and CRLF
// tolerated, but a longer comment that merely starts with the marker does
// not count). Detection is deliberately permissive — this is a firewall that
// should catch any promoted draft.
export const containsDraftMarker = (content: string): boolean =>
  content
    .split("\n")
    .some((line) => line.trim() === DRAFT_MARKER || line.trim() === LEGACY_DRAFT_MARKER);

// File-reading wrapper of containsDraftMarker. bootstrap writes the marker near
// the top of a draft, after any `# language:` directive. A missing file is not
// a draft.
export const hasDraftMarker = async (absPath: string): Promise<boolean> => {
  const content = await readFileOrNull(absPath);
  return content !== null && containsDraftMarker(content);
};

const isSpaceOrTab = (char: string | undefined): boolean => char === " " || char === "\t";

// CommonMark の閉じの # の並び（前が空白か行頭で、後ろは空白だけ）を外す。正規表現で書くと
// 空白の長い並びで二乗の時間がかかる（PR の作者が書ける見出しで CI を止められる）ので、
// 末尾から 1 回だけ走査する。
const stripClosingSequence = (text: string): string => {
  let end = text.length;
  while (end > 0 && isSpaceOrTab(text[end - 1])) end -= 1;
  let start = end;
  while (start > 0 && text[start - 1] === "#") start -= 1;
  const isClosing = start < end && (start === 0 || isSpaceOrTab(text[start - 1]));
  return text.slice(0, isClosing ? start : end);
};

// CommonMark ATX: 0-3 spaces, 1-6 #, whitespace or EOL, optional closing #.
const parseHeading = (line: string): { level: number; text: string } | null => {
  if (hasLineTerminator(line)) return null;
  const match = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/);
  if (!match) return null;
  return {
    level: match[1].length,
    text: stripClosingSequence(match[2] ?? "").trim(),
  };
};

const headingLevelOf = (line: string): number | null => parseHeading(line)?.level ?? null;

const assertValidLevel = (fn: string, level: number): void => {
  if (!Number.isInteger(level) || level < 1 || level > 6) {
    throw new Error(`${fn}: level must be an integer in 1-6 (got ${level})`);
  }
};

export interface Heading {
  /** 1-based line number of the heading line. */
  line: number;
  /** ATX の前後の空白と任意の閉じ # を除いた見出し本文。 */
  text: string;
}

export interface HeadingCandidate extends Heading {
  /** 旧 API が発見できた行だけ、その API が返した参照名を保持する。 */
  legacyText?: string;
}

// Every ATX heading of exactly `level` in `content`, in document order,
// skipping fenced code blocks and HTML comment blocks. Used by check.ts to enumerate a spec doc's
// headings for unregistered-heading and duplicate-heading detection — the
// same "what heading does this line spell" logic computeHeadingSectionHash
// uses to find its target section, generalized to every match instead of the
// first.
const collectHeadingCandidates = (
  lines: string[],
  level: number,
  ignored: boolean[],
): HeadingCandidate[] => {
  const headings: HeadingCandidate[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (ignored[index]) {
      continue;
    }
    const line = lines[index];
    const parsed = parseHeading(line);
    if (parsed?.level === level) {
      const legacyText = line.startsWith(`${"#".repeat(level)} `)
        ? line.trimEnd().slice(level + 1)
        : undefined;
      headings.push({ line: index + 1, text: parsed.text, legacyText });
    }
  }
  return headings;
};

export const listHeadingCandidates = (content: string, level: number): HeadingCandidate[] => {
  assertValidLevel("listHeadings", level);
  const lines = content.split("\n");
  return collectHeadingCandidates(lines, level, scanBlocks(lines, true).ignored);
};

export const listHeadings = (content: string, level: number): Heading[] =>
  listHeadingCandidates(content, level).map(({ line, text }) => ({ line, text }));

// 旧 raw 名と別の canonical 名が衝突しても、保存済み参照を別の節へ移さない。
// 文書全体の旧完全一致を優先し、無い場合だけ現在の正規化名を照合する。
export const resolveHeadingReference = (
  headings: HeadingCandidate[],
  reference: string,
): HeadingCandidate | undefined =>
  headings.find((heading) => heading.legacyText === reference) ??
  headings.find((heading) => heading.text === reference);

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
  level = 2,
  /** エラー文に添える、この参照を登録したリンクの id。 */
  linkId?: string,
): Promise<string> => {
  if (!Number.isInteger(level) || level < 1 || level > 6) {
    throw new Error(`computeHeadingSectionHash: level must be an integer in 1-6 (got ${level})`);
  }
  const content = await readFileOrNull(absPath);
  if (content === null) {
    return FILE_MISSING;
  }
  return hashHeadingSectionContent(content, heading, level, {
    file: path.basename(absPath),
    linkId,
  });
};

type SectionRange = { start: number; end: number };

const sectionRange = (
  lines: string[],
  heading: string,
  level: number,
  ignored: boolean[],
): SectionRange | undefined => {
  const target = resolveHeadingReference(collectHeadingCandidates(lines, level, ignored), heading);
  if (target === undefined) return undefined;
  const start = target.line - 1;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (ignored[i]) continue;
    const nextLevel = headingLevelOf(lines[i]);
    if (nextLevel !== null && nextLevel <= level) return { start, end: i };
  }
  return { start, end: lines.length };
};

const hashRange = (lines: string[], range: SectionRange | undefined): string =>
  range === undefined ? SECTION_MISSING : sha256(lines.slice(range.start, range.end).join("\n"));

interface SectionBoundaries {
  /** v1 の従来の規則（コメントを認識しない）の範囲。v1 の hash はこの範囲で計算する。 */
  original: SectionRange | undefined;
  legacy: BlockScan;
  /** コメントを認識した走査。中身に `<!--` が無ければ従来の規則と同じなので走査しない。 */
  aware?: BlockScan;
  /** コメントを認識すると、節の開始か終端が従来の規則と変わる。 */
  ambiguous: boolean;
}

// 従来の規則とコメントを認識した規則で節の範囲を比べる。v1 の hash を計算する経路（作業ツリー・
// 過去の版）はすべてこの判定を通す。
const sectionBoundaries = (
  content: string,
  lines: string[],
  heading: string,
  level: number,
): SectionBoundaries => {
  const legacy = scanBlocks(lines, false);
  const original = sectionRange(lines, heading, level, legacy.ignored);
  if (!content.includes("<!--")) return { original, legacy, ambiguous: false };
  const aware = scanBlocks(lines, true);
  const visible = sectionRange(lines, heading, level, aware.ignored);
  const ambiguous = original?.start !== visible?.start || original?.end !== visible?.end;
  return { original, legacy, aware, ambiguous };
};

/** 過去のコミットとの照合用。保存済みの v1 の値と比べる hash と、その版で節の境界がコメントで曖昧か。 */
export interface HistoricalV1Section {
  hash: string;
  ambiguous: boolean;
}

// 過去のコミットとの照合専用。保存済みの v1 の値は、その時点の v1 の規則で辿る。境界が曖昧な版は、
// コメントの後ろの本文が変わっても同じ hash になりうるので、照合した側で起点に使わない。
// 新規の bless や作業ツリーの clean 判定には使わない。
export const inspectHistoricalV1Section = (
  content: string,
  heading: string,
  level: number,
): HistoricalV1Section => {
  const lines = content.split("\n");
  const boundaries = sectionBoundaries(content, lines, heading, level);
  return { hash: hashRange(lines, boundaries.original), ambiguous: boundaries.ambiguous };
};

// コメントの中に、従来の規則で見出し（level 以下）またはフェンスとして読まれる行がある。
// 境界の食い違いはこうしたコメントから生じる。
const hidesBoundaryLines = (
  lines: string[],
  level: number,
  legacyIgnored: boolean[],
  block: CommentBlock,
): boolean =>
  lines.slice(block.start, block.end).some((line, offset) => {
    if (parseFence(line) !== null) return true;
    const lineLevel = legacyIgnored[block.start + offset] ? null : headingLevelOf(line);
    return lineLevel !== null && lineLevel <= level;
  });

// エラー文に並べるコメントの位置の上限。8 MiB の spec でもエラー文が 1 行で膨らまないようにする。
const MAX_LISTED_COMMENTS = 10;

// 従来の規則で選ばれた参照の見出しが、このコメントの中にある。
const containsReference = (block: CommentBlock, original: SectionRange | undefined): boolean =>
  original !== undefined && original.start >= block.start && original.start < block.end;

const describeCommentBlock = (block: CommentBlock, original: SectionRange | undefined): string => {
  const notes = [
    block.closed ? undefined : 'not closed: add "-->" where the comment should end',
    containsReference(block, original)
      ? "contains the referenced heading: if the whole section is commented out, remove this reference from the manifest"
      : undefined,
  ].filter((note) => note !== undefined);
  return notes.length === 0
    ? `line ${block.start + 1}`
    : `line ${block.start + 1} (${notes.join("; ")})`;
};

const boundaryError = (
  heading: string,
  level: number,
  lines: string[],
  boundaries: SectionBoundaries,
  source: HeadingSectionSource,
): Error => {
  const where = source.file === undefined ? "" : ` in ${JSON.stringify(source.file)}`;
  const link = source.linkId === undefined ? "" : ` (link ${JSON.stringify(source.linkId)})`;
  // 同じファイルで同じ段の境界を変えうるコメントは、この 1 つのエラーで示す（check は最初のエラーで
  // 止まるので、ほかのファイル・段の衝突は直して流し直したときに出る）。エラー文は CI のログに出るので、
  // 並べるのは先頭の MAX_LISTED_COMMENTS 件と、参照の見出しを含むコメントだけにし、残りは件数で示す。
  const blocks = (boundaries.aware?.comments ?? []).filter((block) =>
    hidesBoundaryLines(lines, level, boundaries.legacy.ignored, block),
  );
  const head = blocks.slice(0, MAX_LISTED_COMMENTS);
  const holding = blocks
    .slice(MAX_LISTED_COMMENTS)
    .filter((block) => containsReference(block, boundaries.original));
  const shown = [...head, ...holding];
  const more = blocks.length - shown.length;
  const listed =
    blocks.length === 0
      ? ""
      : ` HTML comment(s) in this file that hide heading or fence lines, by opening line: ${shown
          .map((block) => describeCommentBlock(block, boundaries.original))
          .join(", ")}${more > 0 ? `, and ${more} more` : ""}.`;
  return new Error(
    `Cannot hash section ${JSON.stringify(heading)}${where}${link} with manifest version 1: an HTML comment changes its boundaries.${listed} Close a comment left open with "-->"; remove a reference whose whole section is inside a comment; otherwise rewrite or indent heading or fence lines in the comment by at least four spaces. Then review the section before updating its hash.`,
  );
};

/** エラー文に添える参照の情報。 */
export interface HeadingSectionSource {
  /** ファイル名（公開の CI ログに出るので、絶対パスでなく basename）。 */
  file?: string;
  linkId?: string;
}

// v1 の hash の意味を変えず、コメントを認識すると登録節の範囲が変わる入力だけを拒否する。
export const hashHeadingSectionContent = (
  content: string,
  heading: string,
  level = 2,
  source: HeadingSectionSource = {},
): string => {
  const lines = content.split("\n");
  const boundaries = sectionBoundaries(content, lines, heading, level);
  if (boundaries.ambiguous) {
    throw boundaryError(heading, level, lines, boundaries, source);
  }
  return hashRange(lines, boundaries.original);
};
