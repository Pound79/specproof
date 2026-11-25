import { AsyncLocalStorage } from "node:async_hooks";
import {
  originOf,
  scanVisible,
  visibleLinesOf,
  type Uncertainty,
  type VisibleScan,
} from "./markdown-blocks.js";
import { firstHazard } from "./hazards.js";
import { dialectsFor, isSpaceOrTab, type Dialect } from "./markdown-html.js";
import { hasLineTerminator, scanLegacy, type LegacyScan } from "./markdown-legacy.js";

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

type ParsedHeading = { level: number; text: string } | null;

// CommonMark ATX: 0-3 spaces, 1-6 #, whitespace or EOL, optional closing #. v1 の従来の規則で、CR・
// U+2028・U+2029 を含む行は見出しにしない（v1 の hash の範囲を変えないため、この規則は変えない）。
export const parseHeading = (line: string): ParsedHeading => {
  if (hasLineTerminator(line)) return null;
  const match = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/);
  if (!match) return null;
  return {
    level: match[1].length,
    text: stripClosingSequence(match[2] ?? "").trim(),
  };
};

// 表示上の規則の ATX 見出し。表示上の行は単独の CR で分けてあり、CommonMark では U+2028・U+2029 は
// 改行でないので、ほかの文字と同じに読む（`[^]` は `.` と違ってこの 2 文字にも一致する）。
const parseVisibleHeading = (line: string): ParsedHeading => {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+([^]*))?$/.exec(line);
  if (match === null) return null;
  return {
    level: match[1].length,
    text: stripClosingSequence(match[2] ?? "").trim(),
  };
};

type HeadingParser = (line: string) => ParsedHeading;

export const headingLevelOf = (line: string): number | null => parseHeading(line)?.level ?? null;

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

const legacyTextOf = (line: string, level: number): string | undefined =>
  line.startsWith(`${"#".repeat(level)} `) ? line.trimEnd().slice(level + 1) : undefined;

// Every ATX heading of exactly `level` in `lines`, in document order, skipping the lines a scan
// marks as ignored (fenced code, HTML blocks). Used for unregistered-heading and duplicate-heading
// detection and to find the target section of computeHeadingSectionHash.
const collectHeadingCandidates = (
  lines: readonly string[],
  level: number,
  ignored: ArrayLike<boolean | number>,
  parse: HeadingParser,
): HeadingCandidate[] => {
  const headings: HeadingCandidate[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (ignored[index]) {
      continue;
    }
    const line = lines[index];
    const parsed = parse(line);
    if (parsed?.level === level) {
      headings.push({ line: index + 1, text: parsed.text, legacyText: legacyTextOf(line, level) });
    }
  }
  return headings;
};

// 旧 raw 名と別の canonical 名が衝突しても、保存済み参照を別の節へ移さない。
// 文書全体の旧完全一致を優先し、無い場合だけ現在の正規化名を照合する。
export const resolveHeadingReference = (
  headings: HeadingCandidate[],
  reference: string,
): HeadingCandidate | undefined =>
  headings.find((heading) => heading.legacyText === reference) ??
  headings.find((heading) => heading.text === reference);

export type SectionRange = { start: number; end: number };

const sectionRange = (
  lines: readonly string[],
  heading: string,
  level: number,
  ignored: ArrayLike<boolean | number>,
  parse: HeadingParser,
): (SectionRange & { exact: boolean }) | undefined => {
  const target = resolveHeadingReference(
    collectHeadingCandidates(lines, level, ignored, parse),
    heading,
  );
  if (target === undefined) return undefined;
  const start = target.line - 1;
  const exact = target.legacyText === heading;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (ignored[i]) continue;
    const nextLevel = parse(lines[i])?.level;
    if (nextLevel !== undefined && nextLevel <= level) return { start, end: i, exact };
  }
  return { start, end: lines.length, exact };
};

/** 方言ごとの表示上の走査。 */
export interface Pass {
  dialect: Dialect;
  scan: VisibleScan;
}

/** 1 つの中身の、従来の規則と表示上の規則（方言ごと）の走査。 */
export interface ContentScans {
  /** LF で分けた行。 */
  lines: string[];
  legacy: LegacyScan;
  /** 先頭は CommonMark。方言で読み方が変わりうる文字列が無ければ CommonMark だけ。 */
  passes: Pass[];
  /** 最初の hazard（表示上の行の番号。どの方言の走査でも行は同じ）。 */
  hazard: Uncertainty | undefined;
}

const scanContent = (content: string): ContentScans => {
  const lines = content.split("\n");
  const visible = visibleLinesOf(lines);
  const hazard = firstHazard(visible);
  return {
    hazard: hazard && { line: hazard.line, construct: hazard.kind, hazard: true },
    lines,
    legacy: scanLegacy(lines),
    passes: dialectsFor(content).map((dialect) => ({
      dialect,
      scan: scanVisible(visible, dialect),
    })),
  };
};

// 1 回の check・update の間だけ、同じ中身の走査を使い回す（同じ spec の節を参照するリンクが多いと、
// 参照ごとにファイル全体を走査し直すことになる）。実行ごとに withSectionScanCache で作り、実行が
// 終われば捨てる（モジュールに残さない）。保持するのは直近の MAX_CACHED_CONTENTS 件で、中身の長さの
// 合計が MAX_CACHED_LENGTH（読み込みの上限の 1 ファイル分）を超えれば古いものから捨てる（走査は
// 中身の何倍ものメモリを使うので、上限に近い spec を何件も持たない）。
const MAX_CACHED_CONTENTS = 8;
const MAX_CACHED_LENGTH = 8 * 1024 * 1024;
const scanCache = new AsyncLocalStorage<Map<string, ContentScans>>();

/**
 * run の中（非同期の続きも含む）で読んだ中身の走査を、run の間だけ使い回す。すでに使い回しの中なら、
 * その使い回しを続けて使う（入れ子で別の使い回しを作らない）。
 */
export const withSectionScanCache = <T>(run: () => Promise<T>): Promise<T> =>
  scanCache.getStore() === undefined ? scanCache.run(new Map(), run) : run();

export const scansOf = (content: string): ContentScans => {
  const cache = scanCache.getStore();
  if (cache === undefined) return scanContent(content);
  const cached = cache.get(content);
  if (cached !== undefined) {
    cache.delete(content);
    cache.set(content, cached);
    return cached;
  }
  // 新しい走査の前に古いものを捨て、同時に持つ走査を増やさない。
  let length = content.length;
  for (const key of cache.keys()) length += key.length;
  for (const key of cache.keys()) {
    if (cache.size < MAX_CACHED_CONTENTS && length <= MAX_CACHED_LENGTH) break;
    cache.delete(key);
    length -= key.length;
  }
  const scans = scanContent(content);
  if (content.length <= MAX_CACHED_LENGTH) cache.set(content, scans);
  return scans;
};

/** 表示上（CommonMark）の見出し。行番号は LF で分けた行で数える（単独の CR の後の見出しは、その CR を含む行の番号）。 */
export const visibleHeadingCandidates = (
  scans: ContentScans,
  level: number,
): HeadingCandidate[] => {
  const { scan } = scans.passes[0];
  return collectHeadingCandidates(scan.lines, level, scan.ignored, parseVisibleHeading).map(
    (heading) => ({ ...heading, line: originOf(scan, heading.line - 1) + 1 }),
  );
};

// 表示上の行の番号を、LF で分けた行の番号にする。LF で分けた行の途中（単独の CR の後）は対応する
// 行が無いので NaN にし、どの範囲とも一致させない。
export const legacyIndexOf = (scan: VisibleScan, legacyLength: number, index: number): number => {
  if (index === scan.lines.length) return legacyLength;
  const line = originOf(scan, index);
  return index > 0 && originOf(scan, index - 1) === line ? Number.NaN : line;
};

// 読み方を決めきれない行から後ろに、参照の見出しになりうる行があるか（ignored は推測なので見ない）。
const mayBeReferencedAfter = (
  scan: VisibleScan,
  from: number,
  heading: string,
  level: number,
): boolean => {
  for (let i = from; i < scan.lines.length; i += 1) {
    const line = scan.lines[i];
    const parsed = parseVisibleHeading(line);
    if (
      parsed?.level === level &&
      (parsed.text === heading || legacyTextOf(line, level) === heading)
    ) {
      return true;
    }
  }
  return false;
};

export type BoundaryFailure =
  /** 表示上の規則が、節の範囲に掛かる行の読み方を決めきれない。 */
  | { reason: "uncertain"; pass: Pass; uncertainty: Uncertainty }
  /** 表示上の規則（この方言）では、節の開始か終端が従来の規則と変わる。 */
  | { reason: "boundaries"; pass: Pass; visible: SectionRange | undefined };

export interface SectionBoundaries {
  /** v1 の従来の規則（HTML ブロックもリストも読まない）の範囲。v1 の hash はこの範囲で計算する。 */
  original: SectionRange | undefined;
  /** 拒否する理由。undefined なら、どの方言でも表示上の範囲が従来の範囲と一致する。 */
  failure: BoundaryFailure | undefined;
}

// 従来の規則と表示上の規則（方言ごと）で節の範囲を比べる。v1 の hash を計算する経路（作業ツリー・
// 過去の版）はすべてこの判定を通す。表示上の範囲が読み方を決めきれない行に掛かれば（終端の見出しの
// 行を含む）、範囲を推測せずに拒否する。参照の見出しが見つからないか、正規化した名前でしか一致しない
// ときは、決めきれない行より後ろに参照の見出しになりうる行があっても拒否する。
export const sectionBoundaries = (
  scans: ContentScans,
  heading: string,
  level: number,
): SectionBoundaries => {
  const { lines, legacy, passes } = scans;
  const original = sectionRange(lines, heading, level, legacy.ignored, parseHeading);
  const bounds = original && { start: original.start, end: original.end };
  for (const pass of passes) {
    const { scan } = pass;
    const range = sectionRange(scan.lines, heading, level, scan.ignored, parseVisibleHeading);
    // hazard と走査が決めきれない行の、先の方から末尾までを決めきれない。
    const uncertainty =
      scans.hazard !== undefined &&
      (scan.uncertain === undefined || scans.hazard.line <= scan.uncertain.line)
        ? scans.hazard
        : scan.uncertain;
    if (
      uncertainty !== undefined &&
      ((range !== undefined && range.end >= uncertainty.line) ||
        (range?.exact !== true && mayBeReferencedAfter(scan, uncertainty.line, heading, level)))
    ) {
      return { original: bounds, failure: { reason: "uncertain", pass, uncertainty } };
    }
    const visible = range && {
      start: legacyIndexOf(scan, lines.length, range.start),
      end: legacyIndexOf(scan, lines.length, range.end),
    };
    if (original?.start !== visible?.start || original?.end !== visible?.end) {
      const shown = range && { start: range.start, end: range.end };
      return { original: bounds, failure: { reason: "boundaries", pass, visible: shown } };
    }
  }
  return { original: bounds, failure: undefined };
};
