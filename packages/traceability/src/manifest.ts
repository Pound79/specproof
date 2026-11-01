import { realpath } from "node:fs/promises";
import path from "node:path";
import { readManifestFile } from "./manifest-io.js";
import { stringify } from "yaml";
import { parseRepositoryYaml } from "./yaml-parse.js";
import { writeFileAtomic } from "./atomic-write.js";
import { replaceManifestHashes } from "./manifest-text.js";
import { resolveWithinRoot } from "./resolve.js";
import { FILE_MISSING, PENDING_HASH, SECTION_MISSING } from "./hash.js";

export interface SpecRef {
  path: string;
  heading: string;
  hash: string;
  /** ATX heading level of `heading` (1-6). Defaults to 2 (`## `) when omitted. */
  headingLevel?: number;
}

export interface FileRef {
  path: string;
  hash: string;
}

export interface TraceabilityLink {
  id: string;
  label: string;
  spec: SpecRef[];
  impl: FileRef[];
  features: FileRef[];
  /** 条件 ID の任意の対応。形式は consumer が定め、同じ ID を別 link に置ける。 */
  criteria?: string[];
}

export interface TraceabilityManifest {
  version: 1;
  links: TraceabilityLink[];
}

const MAX_PATH_LENGTH = 4096;
const MAX_HEADING_LENGTH = 1024;
const MAX_LINKS = 10_000;
const MAX_REFS_PER_LINK = 1_000;
const MAX_TOTAL_REFS = 20_000;
const MAX_ID_LENGTH = 256;
const CONTROL_OR_SEPARATOR = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
// 見出しとラベルは CONTROL_OR_SEPARATOR から水平タブだけを除く。Markdown の見出しの行はタブを
// 含みえて、旧い specproof が見出しのタブをそのまま保存した manifest を読めるようにする
// （タブで行は偽装できない）。
const CONTROL_OR_SEPARATOR_EXCEPT_TAB = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029]/u;
// 保存できる hash は sha256 の 16 進（hash.ts が出す小文字 64 桁）と、決まった値だけ。
// PENDING は新しい参照の仮の値、FILE_MISSING / SECTION_MISSING は旧い manifest や手で書いた
// manifest に残りうる見つからない印（check は常に missing と報告し、update は書き込まない）。
const SHA256_HEX = /^[0-9a-f]{64}$/;
const NON_DIGEST_HASHES: readonly string[] = [PENDING_HASH, FILE_MISSING, SECTION_MISSING];
const isStorableHash = (hash: unknown): boolean =>
  typeof hash === "string" && (SHA256_HEX.test(hash) || NON_DIGEST_HASHES.includes(hash));
const MAX_LABEL_LENGTH = 1024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const fail = (where: string, detail: string): never => {
  throw new Error(
    `Invalid traceability manifest at ${where}: ${detail}. ` +
      "Expected refs of shape { path: string, hash: string } " +
      "(spec refs also need heading: string).",
  );
};

const assertFileRef: (value: unknown, where: string) => asserts value is FileRef = (
  value,
  where,
) => {
  if (!isRecord(value)) {
    return fail(where, "expected a reference object");
  }
  if (
    typeof value.path !== "string" ||
    value.path.length === 0 ||
    value.path.length > MAX_PATH_LENGTH ||
    value.path.includes("\0")
  ) {
    fail(where, `path must be 1-${MAX_PATH_LENGTH} characters without NUL`);
  }
  // 値はエラーに出さない（PR の作者が書けるので、ログの行を偽装させない）。
  if (!isStorableHash(value.hash)) {
    fail(
      where,
      `hash must be a sha256 digest (64 lowercase hex characters), ${PENDING_HASH}, ${FILE_MISSING} or ${SECTION_MISSING}`,
    );
  }
};

const assertSpecRef: (value: unknown, where: string) => asserts value is SpecRef = (
  value,
  where,
) => {
  assertFileRef(value, where);
  const record = value as FileRef & Record<string, unknown>;
  if (typeof record.heading !== "string" || record.heading.length > MAX_HEADING_LENGTH) {
    fail(where, `heading must be a string of at most ${MAX_HEADING_LENGTH} characters`);
  } else if (CONTROL_OR_SEPARATOR_EXCEPT_TAB.test(record.heading)) {
    // 見出しは check の報告と PR コメントにそのまま出る。link id と同じく行を偽装させない。
    fail(where, "heading must not contain control or separator characters");
  }
  if (
    record.headingLevel !== undefined &&
    (typeof record.headingLevel !== "number" ||
      !Number.isInteger(record.headingLevel) ||
      record.headingLevel < 1 ||
      record.headingLevel > 6)
  ) {
    fail(where, "headingLevel must be an integer from 1 through 6");
  }
};

const assertRefArray = (
  value: unknown,
  where: string,
  assertValid: (ref: unknown, refWhere: string) => void,
): void => {
  if (!Array.isArray(value)) {
    fail(where, "expected an array");
  }
  (value as unknown[]).forEach((ref, index) => {
    assertValid(ref, `${where}[${index}]`);
  });
};

const assertCriteria = (value: unknown, where: string): void => {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    return fail(where, "criteria must be a string array");
  }
  const seen = new Set<string>();
  for (const [index, id] of value.entries()) {
    const at = `${where}[${index}]`;
    if (typeof id !== "string" || id.length === 0) {
      return fail(at, "criterion ID must be a non-empty string");
    }
    if (CONTROL_OR_SEPARATOR.test(id)) {
      fail(at, "criterion ID must not contain control or separator characters");
    }
    if (seen.has(id)) {
      fail(at, "criterion IDs must be unique within a link");
    }
    seen.add(id);
  }
};

// この specproof が読み書きする manifest の version（ADR 0010）。
const SUPPORTED_MANIFEST_VERSION = 1;

const assertManifestShape: (value: unknown) => asserts value is TraceabilityManifest = (value) => {
  // 新しい specproof が書いた manifest を、旧い規則で読んだり取り直したりしない（ADR 0010 の 3）。
  if (
    isRecord(value) &&
    typeof value.version === "number" &&
    Number.isInteger(value.version) &&
    value.version > SUPPORTED_MANIFEST_VERSION
  ) {
    throw new Error(
      `Unsupported traceability manifest: manifest version ${value.version} is newer than this specproof supports (${SUPPORTED_MANIFEST_VERSION}). ` +
        "Written by a newer specproof — update @pound79/specproof-traceability (and the version pinned in your workflows) instead of re-blessing the hashes.",
    );
  }
  if (
    !isRecord(value) ||
    value.version !== SUPPORTED_MANIFEST_VERSION ||
    !Array.isArray(value.links)
  ) {
    throw new Error("Invalid traceability manifest: expected { version: 1, links: [...] }");
  }
  if (value.links.length > MAX_LINKS) {
    throw new Error(
      `Invalid traceability manifest: at most ${MAX_LINKS.toLocaleString("en-US")} links are allowed`,
    );
  }
  let totalRefs = 0;
  value.links.forEach((link: unknown, index: number) => {
    const where = `links[${index}]`;
    if (!isRecord(link)) {
      fail(where, `expected a link object, got ${JSON.stringify(link)}`);
      return;
    }
    if (typeof link.id !== "string" || link.id === "" || link.id.length > MAX_ID_LENGTH) {
      fail(where, `id must be a non-empty string of at most ${MAX_ID_LENGTH} characters`);
    } else if (CONTROL_OR_SEPARATOR.test(link.id)) {
      // id は check の報告と PR コメントにそのまま出る。改行で見出しや行を偽装させない。
      fail(where, "id must not contain control or separator characters");
    }
    // YAML のブロック形式（label: > / label: |）は末尾に改行が付く。ラベルは表示にしか使わないので
    // 末尾の改行を除いて検査する。保存する値は変えない（update は元の YAML の hash だけを書き換え、
    // 読み込んだ値と元の YAML が一致することを確かめる）。
    const label = typeof link.label === "string" ? link.label.replace(/\n+$/, "") : undefined;
    if (label === undefined || label === "" || (link.label as string).length > MAX_LABEL_LENGTH) {
      fail(
        `${where} (id: ${String(link.id)})`,
        `label must be a non-empty string of at most ${MAX_LABEL_LENGTH} characters`,
      );
    } else if (CONTROL_OR_SEPARATOR_EXCEPT_TAB.test(label)) {
      // ラベルも list の出力と --json に出る。link id と同じく行を偽装させない。
      fail(`${where} (id: ${link.id})`, "label must not contain control or separator characters");
    }
    assertRefArray(link.spec, `${where}.spec`, assertSpecRef);
    assertRefArray(link.impl, `${where}.impl`, assertFileRef);
    assertRefArray(link.features, `${where}.features`, assertFileRef);
    assertCriteria(link.criteria, `${where}.criteria`);
    const refCount =
      (link.spec as unknown[]).length +
      (link.impl as unknown[]).length +
      (link.features as unknown[]).length;
    if (refCount > MAX_REFS_PER_LINK) {
      throw new Error(
        `Invalid traceability manifest at ${where}: at most ${MAX_REFS_PER_LINK.toLocaleString("en-US")} references are allowed per link`,
      );
    }
    totalRefs += refCount;
    if (totalRefs > MAX_TOTAL_REFS) {
      throw new Error(
        `Invalid traceability manifest: at most ${MAX_TOTAL_REFS.toLocaleString("en-US")} total references are allowed`,
      );
    }
  });

  const seenIds = new Set<string>();
  const duplicates = new Set<string>();
  for (const { id } of value.links as TraceabilityLink[]) {
    if (seenIds.has(id)) duplicates.add(id);
    seenIds.add(id);
  }
  if (duplicates.size > 0) {
    throw new Error(
      `Invalid traceability manifest: duplicate link id(s): ${[...duplicates].join(", ")}`,
    );
  }
};

const manifestSources = new WeakMap<TraceabilityManifest, string>();

export const loadManifest = async (manifestPath: string): Promise<TraceabilityManifest> => {
  const raw = await readManifestFile(manifestPath);
  const parsed = parseRepositoryYaml(raw, path.basename(manifestPath));
  assertManifestShape(parsed);
  manifestSources.set(parsed, raw);
  return parsed;
};

export const saveManifest = async (
  manifestPath: string,
  manifest: TraceabilityManifest,
  original?: TraceabilityManifest,
  /** 指定時は、リンク解決後の書込先を保存直前にも repo 内へ制限する。 */
  repoRoot?: string,
): Promise<void> => {
  // 既存の writer の振る舞いを保ち、新しい criteria だけをファイル更新前に検査する。
  manifest.links.forEach((link, index) => {
    assertCriteria(link.criteria, `links[${index}].criteria`);
  });
  const header =
    "# Traceability manifest linking spec sections, implementation files, and\n" +
    "# BDD feature files. Each hash is the sha256 hex digest recorded at the last\n" +
    "# update (a new ref may hold the placeholder PENDING). After reviewing a\n" +
    "# change, refresh them with:\n" +
    "#   specproof-update\n";
  const source = original === undefined ? undefined : manifestSources.get(original);
  if (original !== undefined && source === undefined) {
    throw new Error("Original manifest must come from loadManifest");
  }
  const text =
    original && source !== undefined
      ? replaceManifestHashes(source, original, manifest)
      : header + stringify(manifest);
  await writeFileAtomic(await writeTargetOf(manifestPath, repoRoot), text, source);
};

/**
 * 読み込み側と同じく最終要素のリンクを辿り、実体を原子的に置き換える。
 * リンク自体は残す。リンク切れはそのまま渡し、writer が通常ファイルでないとして拒否する。
 * update は repoRoot を渡し、hash 計算中に外へ差し替わったリンクもここで拒否する。
 * 検証した実体パスを writer に渡し、元のリンクを再び辿らせない。
 */
const writeTargetOf = async (manifestPath: string, repoRoot?: string): Promise<string> => {
  let target: string;
  try {
    target = await realpath(manifestPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    target = manifestPath;
  }
  if (repoRoot !== undefined) resolveWithinRoot(repoRoot, target);
  return target;
};
