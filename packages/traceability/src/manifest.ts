import { open, writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";

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
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
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

const assertFileRef: (
  value: unknown,
  where: string,
) => asserts value is FileRef = (value, where) => {
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
  if (
    typeof value.hash !== "string" ||
    value.hash.length > MAX_HASH_LENGTH
  ) {
    fail(where, `hash must be a string of at most ${MAX_HASH_LENGTH} characters`);
  }
};

const assertSpecRef: (
  value: unknown,
  where: string,
) => asserts value is SpecRef = (value, where) => {
  assertFileRef(value, where);
  const record = value as FileRef & Record<string, unknown>;
  if (
    typeof record.heading !== "string" ||
    record.heading.length > MAX_HEADING_LENGTH
  ) {
    fail(
      where,
      `heading must be a string of at most ${MAX_HEADING_LENGTH} characters`,
    );
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

const assertManifestShape: (
  value: unknown,
) => asserts value is TraceabilityManifest = (value) => {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.links)) {
    throw new Error(
      "Invalid traceability manifest: expected { version: 1, links: [...] }",
    );
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
    if (
      typeof link.id !== "string" ||
      link.id === "" ||
      link.id.length > MAX_ID_LENGTH
    ) {
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

export const loadManifest = async (
  manifestPath: string,
): Promise<TraceabilityManifest> => {
  const handle = await open(manifestPath, "r");
  let raw: string;
  try {
    const { size } = await handle.stat();
    if (size > MAX_MANIFEST_BYTES) {
      throw new Error("Invalid traceability manifest: file exceeds 8 MiB");
    }
    raw = await handle.readFile({ encoding: "utf8" });
  } finally {
    await handle.close();
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_MANIFEST_BYTES) {
    throw new Error("Invalid traceability manifest: file exceeds 8 MiB");
  }
  const parsed: unknown = parse(raw);
  assertManifestShape(parsed);
  return parsed;
};

export const saveManifest = async (
  manifestPath: string,
  manifest: TraceabilityManifest,
): Promise<void> => {
  const header =
    "# Traceability manifest linking spec sections, implementation files, and\n" +
    "# BDD feature files. Hashes are sha256; refresh them with:\n" +
    "#   specproof-update\n";
  await writeFile(manifestPath, header + stringify(manifest), "utf8");
};
