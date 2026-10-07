import { readManifestFile } from "./manifest-io.js";
import { parse, stringify } from "yaml";
import { writeFileAtomic } from "./atomic-write.js";
import { replaceManifestHashes } from "./manifest-text.js";

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
const MAX_HASH_LENGTH = 256;
const MAX_LINKS = 10_000;
const MAX_REFS_PER_LINK = 1_000;
const MAX_TOTAL_REFS = 20_000;
const MAX_ID_LENGTH = 256;
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
  if (typeof value.hash !== "string" || value.hash.length > MAX_HASH_LENGTH) {
    fail(where, `hash must be a string of at most ${MAX_HASH_LENGTH} characters`);
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
    if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(id)) {
      fail(at, "criterion ID must not contain control or separator characters");
    }
    if (seen.has(id)) {
      fail(at, "criterion IDs must be unique within a link");
    }
    seen.add(id);
  }
};

const assertManifestShape: (value: unknown) => asserts value is TraceabilityManifest = (value) => {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.links)) {
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
    }
    if (
      typeof link.label !== "string" ||
      link.label === "" ||
      link.label.length > MAX_LABEL_LENGTH
    ) {
      fail(
        `${where} (id: ${String(link.id)})`,
        `label must be a non-empty string of at most ${MAX_LABEL_LENGTH} characters`,
      );
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
  const parsed: unknown = parse(raw);
  assertManifestShape(parsed);
  manifestSources.set(parsed, raw);
  return parsed;
};

export const saveManifest = async (
  manifestPath: string,
  manifest: TraceabilityManifest,
  original?: TraceabilityManifest,
): Promise<void> => {
  // 既存の writer の振る舞いを保ち、新しい criteria だけをファイル更新前に検査する。
  manifest.links.forEach((link, index) => {
    assertCriteria(link.criteria, `links[${index}].criteria`);
  });
  const header =
    "# Traceability manifest linking spec sections, implementation files, and\n" +
    "# BDD feature files. Hashes are sha256; refresh them with:\n" +
    "#   specproof-update\n";
  const source = original === undefined ? undefined : manifestSources.get(original);
  if (original !== undefined && source === undefined) {
    throw new Error("Original manifest must come from loadManifest");
  }
  const text =
    original && source !== undefined
      ? replaceManifestHashes(source, original, manifest)
      : header + stringify(manifest);
  await writeFileAtomic(manifestPath, text, source);
};
