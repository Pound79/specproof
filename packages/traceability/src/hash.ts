import { createHash } from "node:crypto";
import path from "node:path";
import { readRegularFile } from "./bounded-read.js";
import { boundaryError, uncertaintyError, type HeadingSectionSource } from "./section-errors.js";
import {
  scansOf,
  sectionBoundaries,
  visibleHeadingCandidates,
  type HeadingCandidate,
  type SectionRange,
} from "./section-scan.js";

export {
  resolveHeadingReference,
  withSectionScanCache,
  type Heading,
  type HeadingCandidate,
} from "./section-scan.js";
export type { HeadingSectionSource } from "./section-errors.js";

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

const assertValidLevel = (fn: string, level: number): void => {
  if (!Number.isInteger(level) || level < 1 || level > 6) {
    throw new Error(`${fn}: level must be an integer in 1-6 (got ${level})`);
  }
};

// Every ATX heading of exactly `level` in `content`, in document order, as CommonMark shows it:
// headings in fenced code (including fences in list items) and in HTML blocks are skipped, and a
// lone carriage return starts a new line. Used by check.ts to enumerate a spec doc's headings for
// unregistered-heading and duplicate-heading detection.
export const listHeadingCandidates = (content: string, level: number): HeadingCandidate[] => {
  assertValidLevel("listHeadings", level);
  return visibleHeadingCandidates(scansOf(content), level);
};

export const listHeadings = (content: string, level: number) =>
  listHeadingCandidates(content, level).map(({ line, text }) => ({ line, text }));

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

const hashRange = (lines: string[], range: SectionRange | undefined): string =>
  range === undefined ? SECTION_MISSING : sha256(lines.slice(range.start, range.end).join("\n"));

/** 過去のコミットとの照合用。保存済みの v1 の値と比べる hash と、その版で節の境界が HTML ブロックなどで曖昧か。 */
export interface HistoricalV1Section {
  hash: string;
  ambiguous: boolean;
}

// 過去のコミットとの照合専用。保存済みの v1 の値は、その時点の v1 の規則で辿る。境界が曖昧な版（表示上の
// 規則で範囲が変わるか、読み方を決めきれない）は、ブロックの後ろの本文が変わっても同じ hash になりうる
// ので、照合した側で起点に使わない。新規の bless や作業ツリーの clean 判定には使わない。
export const inspectHistoricalV1Section = (
  content: string,
  heading: string,
  level: number,
): HistoricalV1Section => {
  const scans = scansOf(content);
  const { original, failure } = sectionBoundaries(scans, heading, level);
  return { hash: hashRange(scans.lines, original), ambiguous: failure !== undefined };
};

// v1 の hash の意味を変えず、表示上の規則（CommonMark と、読み方の違う方言）で登録節の範囲が変わる入力と、
// 範囲に掛かる行の読み方を決めきれない入力だけを拒否する。
export const hashHeadingSectionContent = (
  content: string,
  heading: string,
  level = 2,
  source: HeadingSectionSource = {},
): string => {
  const scans = scansOf(content);
  const { original, failure } = sectionBoundaries(scans, heading, level);
  if (failure?.reason === "uncertain") throw uncertaintyError(heading, failure, source);
  if (failure !== undefined) {
    throw boundaryError(heading, level, scans, original, failure, source);
  }
  return hashRange(scans.lines, original);
};
