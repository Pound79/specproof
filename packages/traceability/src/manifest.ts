import { readFile, writeFile } from "node:fs/promises";
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isFileRef = (value: unknown): value is FileRef =>
  isRecord(value) &&
  typeof value.path === "string" &&
  typeof value.hash === "string";

const isSpecRef = (value: unknown): value is SpecRef =>
  isRecord(value) &&
  isFileRef(value) &&
  typeof value.heading === "string" &&
  (value.headingLevel === undefined ||
    (typeof value.headingLevel === "number" &&
      Number.isInteger(value.headingLevel) &&
      value.headingLevel >= 1 &&
      value.headingLevel <= 6));

const fail = (where: string, detail: string): never => {
  throw new Error(
    `Invalid traceability manifest at ${where}: ${detail}. ` +
      "Expected refs of shape { path: string, hash: string } " +
      "(spec refs also need heading: string).",
  );
};

const assertRefArray = (
  value: unknown,
  where: string,
  isValid: (ref: unknown) => boolean,
): void => {
  if (!Array.isArray(value)) {
    fail(where, "expected an array");
  }
  (value as unknown[]).forEach((ref, index) => {
    if (!isValid(ref)) {
      fail(`${where}[${index}]`, `malformed ref: ${JSON.stringify(ref)}`);
    }
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
  value.links.forEach((link: unknown, index: number) => {
    const where = `links[${index}]`;
    if (!isRecord(link)) {
      fail(where, `expected a link object, got ${JSON.stringify(link)}`);
      return;
    }
    if (typeof link.id !== "string" || link.id === "") {
      fail(where, "missing or non-string id");
    }
    if (typeof link.label !== "string" || link.label === "") {
      fail(`${where} (id: ${String(link.id)})`, "missing or non-string label");
    }
    assertRefArray(link.spec, `${where}.spec`, isSpecRef);
    assertRefArray(link.impl, `${where}.impl`, isFileRef);
    assertRefArray(link.features, `${where}.features`, isFileRef);
  });

  const ids = (value.links as TraceabilityLink[]).map((link) => link.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) {
    const unique = [...new Set(duplicates)];
    throw new Error(
      `Invalid traceability manifest: duplicate link id(s): ${unique.join(", ")}`,
    );
  }
};

export const loadManifest = async (
  manifestPath: string,
): Promise<TraceabilityManifest> => {
  const raw = await readFile(manifestPath, "utf8");
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
    "#   bdd-traceability-update\n";
  await writeFile(manifestPath, header + stringify(manifest), "utf8");
};
